import { loadClientConfig } from "@x402-local/config";
import { parsePaymentRequiredHeader } from "@x402-local/payment-core";
import { createViemSigner } from "@x402-local/signer";

async function main() {
  const config = loadClientConfig();
  const signer = createViemSigner(config.BUYER_PRIVATE_KEY as `0x${string}`);

  const url = "http://localhost:4020/premium/data";
  const first = await fetch(url);

  if (first.status !== 402) {
    console.log("unexpected status", first.status, await first.text());
    return;
  }

  const requiredRaw = first.headers.get("PAYMENT-REQUIRED") ?? "";
  const required = parsePaymentRequiredHeader(requiredRaw);

  // TODO: replace placeholder hash/sign payload with official x402 flow
  const placeholderHash = "0x" + "11".repeat(32) as `0x${string}`;
  const sig = await signer.signHash?.(placeholderHash);

  const second = await fetch(url, {
    headers: {
      "PAYMENT-SIGNATURE": JSON.stringify({
        required: required.raw,
        signature: sig,
        signer: signer.address,
      }),
    },
  });

  console.log("second status", second.status);
  console.log(await second.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
