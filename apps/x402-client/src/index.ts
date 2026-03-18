import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, http, publicActions } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { loadClientConfig } from "@x402-local/config";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

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

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: evmSigner });
  const httpClient = new x402HTTPClient(client);

  const url = process.env.RESOURCE_SERVER_URL ?? "http://localhost:4020/premium/evm";

  const first = await fetch(url, { method: "GET" });
  const firstText = await first.text();
  console.log("first status:", first.status);

  if (first.status !== 402) {
    console.log("first body:", firstText);
    return;
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    name => first.headers.get(name),
    firstText ? JSON.parse(firstText) : undefined,
  );
  console.log("selected requirement candidates:", paymentRequired.accepts.length);

  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const second = await fetch(url, {
    method: "GET",
    headers: paymentHeaders,
  });

  const secondText = await second.text();
  console.log("second status:", second.status);
  console.log("second body:", secondText);

  const paymentResponseHeader = second.headers.get("PAYMENT-RESPONSE");
  if (paymentResponseHeader) {
    const settle = httpClient.getPaymentSettleResponse(name => second.headers.get(name));
    console.log("payment-settle:", JSON.stringify(settle, null, 2));
  } else {
    console.log("no PAYMENT-RESPONSE header present");
    const paymentRequired2 = second.headers.get("PAYMENT-REQUIRED");
    if (paymentRequired2) {
      const decoded = httpClient.getPaymentRequiredResponse(name => second.headers.get(name));
      console.log("second payment-required error:", decoded.error);
    }
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
