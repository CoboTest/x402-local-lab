import { config as loadDotenv } from "dotenv";
import path from "node:path";
import bs58 from "bs58";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { toClientSvmSigner, SOLANA_DEVNET_CAIP2 } from "@x402/svm";

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

  console.log("=== x402 SVM Client (Solana Devnet) ===\n");

  // Decode base58 secret key (64 bytes) → KeyPairSigner
  const secretKeyBytes = bs58.decode(solanaPrivateKey);
  console.log(`Secret key length: ${secretKeyBytes.length} bytes`);
  const keypairSigner = await createKeyPairSignerFromBytes(secretKeyBytes);
  const svmSigner = toClientSvmSigner(keypairSigner);
  console.log(`Signer address: ${keypairSigner.address}`);

  // Register SVM scheme
  const client = new x402Client();
  registerExactSvmScheme(client, {
    signer: svmSigner,
    networks: [SOLANA_DEVNET_CAIP2],
  });
  const httpClient = new x402HTTPClient(client);

  const url = process.env.SVM_RESOURCE_URL ?? LOCAL_SVM_URL;
  console.log(`\nTarget: ${url}\n`);

  // First request — expect 402
  console.log("--- First Request (expect 402) ---");
  const firstOpts: RequestInit = {
    method: "GET",
  };

  const first = await fetch(url, firstOpts);
  const firstText = await first.text();
  console.log(`Status: ${first.status}`);

  if (first.status !== 402) {
    console.log("Body:", firstText);
    console.log("\nEndpoint did not return 402. Exiting.");
    return;
  }

  // Parse PAYMENT-REQUIRED
  const paymentRequiredRaw = first.headers.get("PAYMENT-REQUIRED");
  console.log(`PAYMENT-REQUIRED header present: ${!!paymentRequiredRaw}`);
  const paymentRequiredDecoded = decodeB64Json(paymentRequiredRaw);
  if (paymentRequiredDecoded) {
    console.log("PAYMENT-REQUIRED decoded:", JSON.stringify(paymentRequiredDecoded, null, 2));
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => first.headers.get(name),
    firstText ? JSON.parse(firstText) : undefined,
  );
  console.log(`Accepted payment schemes: ${paymentRequired.accepts.length}`);
  for (const a of paymentRequired.accepts) {
    console.log(`  - network: ${a.network}, scheme: ${a.scheme}, maxAmount: ${a.maxAmountRequired}`);
  }

  // Create payment payload
  console.log("\n--- Creating Payment Payload ---");
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  console.log("Payment payload created");

  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paymentSignatureDecoded = decodeB64Json(paymentHeaders["PAYMENT-SIGNATURE"] ?? null);
  if (paymentSignatureDecoded) {
    console.log("PAYMENT-SIGNATURE decoded:", JSON.stringify(paymentSignatureDecoded, null, 2));
  }

  // Second request — with payment
  console.log("\n--- Second Request (with payment) ---");
  const second = await fetch(url, {
    ...firstOpts,
    headers: {
      ...paymentHeaders,
    },
  });
  const secondText = await second.text();
  console.log(`Status: ${second.status}`);
  console.log("Body:", secondText);

  // Check PAYMENT-RESPONSE
  const paymentResponseHeader = second.headers.get("PAYMENT-RESPONSE");
  if (paymentResponseHeader) {
    const settle = httpClient.getPaymentSettleResponse((name) => second.headers.get(name));
    console.log("\n--- Payment Settlement ---");
    console.log(JSON.stringify(settle, null, 2));
  } else {
    console.log("\nNo PAYMENT-RESPONSE header present");
    const pr2 = second.headers.get("PAYMENT-REQUIRED");
    if (pr2) {
      const decoded = httpClient.getPaymentRequiredResponse((name) => second.headers.get(name));
      console.log("Second PAYMENT-REQUIRED error:", decoded.error);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
