import { config as loadDotenv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, http, publicActions, createPublicClient, formatEther, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { loadClientConfig } from "@x402-local/config";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const addrUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

function decodeB64Json(input: string | null) {
  if (!input) return null;
  try {
    return JSON.parse(Buffer.from(input, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const cfg = loadClientConfig();
  const account = privateKeyToAccount(cfg.BUYER_PRIVATE_KEY as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(cfg.RPC_URL),
  }).extend(publicActions);

  const evmSigner = {
    address: account.address,
    signTypedData: walletClient.signTypedData,
    readContract: walletClient.readContract,
  };

  const reader = createPublicClient({ chain: baseSepolia, transport: http(cfg.RPC_URL) });

  const [ethBefore, usdcBefore] = await Promise.all([
    reader.getBalance({ address: account.address }),
    reader.readContract({
      address: addrUsdc,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  const facilitatorUrl = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
  const supportedRes = await fetch(`${facilitatorUrl}/supported`);
  const supported = await supportedRes.json();

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: evmSigner });
  const httpClient = new x402HTTPClient(client);

  const url = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4020/premium/data";

  const t0 = Date.now();
  const first = await fetch(url, { method: "GET" });
  const firstBodyText = await first.text();
  const t1 = Date.now();

  if (first.status !== 402) {
    throw new Error(`Expected first response 402, got ${first.status}: ${firstBodyText}`);
  }

  const paymentRequiredHeader = first.headers.get("PAYMENT-REQUIRED");
  const paymentRequiredDecoded = decodeB64Json(paymentRequiredHeader);
  const paymentRequired = httpClient.getPaymentRequiredResponse(
    name => first.headers.get(name),
    firstBodyText ? JSON.parse(firstBodyText) : undefined,
  );

  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paymentSignatureDecoded = decodeB64Json(paymentHeaders["PAYMENT-SIGNATURE"] ?? null);

  const second = await fetch(url, { method: "GET", headers: paymentHeaders });
  const secondBodyText = await second.text();
  const t2 = Date.now();

  const paymentResponseHeader = second.headers.get("PAYMENT-RESPONSE");
  const paymentResponseDecoded = decodeB64Json(paymentResponseHeader);

  const [ethAfter, usdcAfter] = await Promise.all([
    reader.getBalance({ address: account.address }),
    reader.readContract({
      address: addrUsdc,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  let txReceipt: unknown = null;
  const txHash = (paymentResponseDecoded as any)?.transaction as `0x${string}` | undefined;
  if (txHash && txHash.startsWith("0x") && txHash.length === 66) {
    try {
      txReceipt = await reader.getTransactionReceipt({ hash: txHash });
    } catch {
      txReceipt = null;
    }
  }

  const report = {
    meta: {
      timestamp: new Date().toISOString(),
      resourceUrl: url,
      facilitatorUrl,
      durationMs: {
        request1: t1 - t0,
        request2: t2 - t1,
        total: t2 - t0,
      },
    },
    addresses: {
      payer: account.address,
      payTo: paymentRequired.accepts?.[0]?.payTo,
      usdcBaseSepolia: addrUsdc,
      facilitatorSigners: supported?.signers ?? null,
    },
    balances: {
      before: {
        eth: formatEther(ethBefore),
        usdc: formatUnits(usdcBefore as bigint, 6),
        usdcRaw: (usdcBefore as bigint).toString(),
      },
      after: {
        eth: formatEther(ethAfter),
        usdc: formatUnits(usdcAfter as bigint, 6),
        usdcRaw: (usdcAfter as bigint).toString(),
      },
    },
    http: {
      firstRequest: {
        method: "GET",
        url,
        headers: {},
      },
      firstResponse: {
        status: first.status,
        headers: {
          paymentRequired: paymentRequiredHeader,
        },
        bodyText: firstBodyText,
        paymentRequiredDecoded,
      },
      secondRequest: {
        method: "GET",
        url,
        headers: paymentHeaders,
        paymentSignatureDecoded,
      },
      secondResponse: {
        status: second.status,
        headers: {
          paymentResponse: paymentResponseHeader,
          paymentRequired: second.headers.get("PAYMENT-REQUIRED"),
        },
        bodyText: secondBodyText,
        paymentResponseDecoded,
      },
    },
    signing: {
      paymentPayload,
      signatureObject: paymentSignatureDecoded,
    },
    settlement: {
      txHash: txHash ?? null,
      txReceipt,
    },
  };

  const outDir = path.resolve(process.cwd(), "../../docs/reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `x402-run-${stamp}.json`);
  const jsonSafe = JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  fs.writeFileSync(jsonPath, jsonSafe);

  const mdPath = path.join(outDir, `x402-run-${stamp}.md`);
  const md = `# x402 Local Run Report\n\n- Time: ${report.meta.timestamp}\n- Resource: ${url}\n- Facilitator: ${facilitatorUrl}\n\n## Result\n- First response: ${first.status}\n- Second response: ${second.status}\n- Tx hash: ${report.settlement.txHash ?? "N/A"}\n\n## Addresses\n- Payer: ${report.addresses.payer}\n- PayTo: ${report.addresses.payTo}\n- USDC (Base Sepolia): ${report.addresses.usdcBaseSepolia}\n\n## Balances\n- Before: ETH ${report.balances.before.eth}, USDC ${report.balances.before.usdc}\n- After: ETH ${report.balances.after.eth}, USDC ${report.balances.after.usdc}\n\n## Files\n- JSON detail: ${jsonPath}\n`;
  fs.writeFileSync(mdPath, md);

  console.log(JSON.stringify({ ok: true, first: first.status, second: second.status, jsonPath, mdPath, txHash: report.settlement.txHash }, null, 2));
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
