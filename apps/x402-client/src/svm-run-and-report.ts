import { config as loadDotenv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import bs58 from "bs58";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import {
  toClientSvmSigner,
  SOLANA_DEVNET_CAIP2,
  USDC_DEVNET_ADDRESS,
} from "@x402/svm";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

const LOCAL_SVM_URL = "http://localhost:4020/premium/svm-data";

function decodeB64Json(input: string | null) {
  if (!input) return null;
  try {
    return JSON.parse(Buffer.from(input, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!solanaPrivateKey) {
    throw new Error("SOLANA_PRIVATE_KEY not set in .env");
  }

  // Setup signer
  const secretKeyBytes = bs58.decode(solanaPrivateKey);
  const keypairSigner = await createKeyPairSignerFromBytes(secretKeyBytes);
  const svmSigner = toClientSvmSigner(keypairSigner);

  // Register SVM scheme
  const client = new x402Client();
  registerExactSvmScheme(client, {
    signer: svmSigner,
    networks: [SOLANA_DEVNET_CAIP2],
  });
  const httpClient = new x402HTTPClient(client);

  const url = process.env.SVM_RESOURCE_URL ?? LOCAL_SVM_URL;

  // --- First request ---
  const t0 = Date.now();
  const first = await fetch(url, {
    method: "GET",
  });
  const firstBodyText = await first.text();
  const t1 = Date.now();

  const paymentRequiredHeader = first.headers.get("PAYMENT-REQUIRED");
  const paymentRequiredDecoded = decodeB64Json(paymentRequiredHeader);

  let paymentPayload: unknown = null;
  let paymentHeaders: Record<string, string> = {};
  let paymentSignatureDecoded: unknown = null;
  let secondStatus: number | null = null;
  let secondBodyText = "";
  let paymentResponseHeader: string | null = null;
  let paymentResponseDecoded: unknown = null;
  let secondPaymentRequired: unknown = null;
  let t2 = t1;

  if (first.status === 402) {
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => first.headers.get(name),
      firstBodyText ? JSON.parse(firstBodyText) : undefined,
    );

    paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
    paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
    paymentSignatureDecoded = decodeB64Json(paymentHeaders["PAYMENT-SIGNATURE"] ?? null);

    // --- Second request ---
    const second = await fetch(url, {
      method: "GET",
      headers: { ...paymentHeaders },
    });
    secondBodyText = await second.text();
    t2 = Date.now();

    secondStatus = second.status;
    paymentResponseHeader = second.headers.get("PAYMENT-RESPONSE");
    paymentResponseDecoded = decodeB64Json(paymentResponseHeader);

    const pr2 = second.headers.get("PAYMENT-REQUIRED");
    if (pr2) {
      secondPaymentRequired = decodeB64Json(pr2);
    }
  }

  // --- Build report ---
  const report = {
    meta: {
      timestamp: new Date().toISOString(),
      chain: "solana",
      network: SOLANA_DEVNET_CAIP2,
      resourceUrl: url,
      durationMs: {
        request1: t1 - t0,
        request2: t2 - t1,
        total: t2 - t0,
      },
    },
    addresses: {
      payer: keypairSigner.address,
      usdcDevnet: USDC_DEVNET_ADDRESS,
    },
    http: {
      firstRequest: {
        method: "GET",
        url,
      },
      firstResponse: {
        status: first.status,
        headers: {
          paymentRequired: paymentRequiredHeader,
        },
        bodyText: firstBodyText,
        paymentRequiredDecoded,
      },
      secondRequest: secondStatus !== null
        ? {
            method: "GET",
            url,
            headers: { ...paymentHeaders },
            paymentSignatureDecoded,
          }
        : null,
      secondResponse: secondStatus !== null
        ? {
            status: secondStatus,
            headers: {
              paymentResponse: paymentResponseHeader,
              paymentRequired: secondPaymentRequired,
            },
            bodyText: secondBodyText,
            paymentResponseDecoded,
          }
        : null,
    },
    signing: {
      paymentPayload,
      signatureObject: paymentSignatureDecoded,
    },
  };

  // --- Write outputs ---
  const outDir = path.resolve(process.cwd(), "../../docs/reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const jsonPath = path.join(outDir, `svm-run-${stamp}.json`);
  const jsonSafe = JSON.stringify(
    report,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  fs.writeFileSync(jsonPath, jsonSafe);

  const mdPath = path.join(outDir, `svm-run-${stamp}.md`);
  const md = [
    "# x402 SVM Run Report",
    "",
    `- Time: ${report.meta.timestamp}`,
    `- Network: ${report.meta.network}`,
    `- Resource: ${url}`,
    "",
    "## Result",
    `- First response: ${first.status}`,
    `- Second response: ${secondStatus ?? "N/A"}`,
    "",
    "## Addresses",
    `- Payer: ${report.addresses.payer}`,
    `- USDC Devnet: ${report.addresses.usdcDevnet}`,
    "",
    "## Timing",
    `- Request 1: ${report.meta.durationMs.request1}ms`,
    `- Request 2: ${report.meta.durationMs.request2}ms`,
    `- Total: ${report.meta.durationMs.total}ms`,
    "",
    `## Files`,
    `- JSON detail: ${jsonPath}`,
    "",
  ].join("\n");
  fs.writeFileSync(mdPath, md);

  console.log(
    JSON.stringify(
      {
        ok: true,
        first: first.status,
        second: secondStatus,
        jsonPath,
        mdPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
