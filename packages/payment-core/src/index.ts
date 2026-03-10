import type { PaymentRequiredHeader, PaymentSignatureHeader } from "@x402-local/types";

export function parsePaymentRequiredHeader(raw: string): PaymentRequiredHeader {
  if (!raw?.trim()) {
    throw new Error("PAYMENT-REQUIRED header is empty");
  }
  return { raw };
}

export function buildPaymentSignatureHeader(signaturePayload: string): PaymentSignatureHeader {
  if (!signaturePayload?.trim()) {
    throw new Error("signaturePayload is empty");
  }
  return { raw: signaturePayload };
}
