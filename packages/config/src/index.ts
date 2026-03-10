import { z } from "zod";

const sharedSchema = z.object({
  X402_NETWORK: z.string().min(1),
  X402_FACILITATOR_URL: z.url(),
  X402_SELLER_PAYTO: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  X402_PRICE_USD: z.string().min(1),
  RPC_URL: z.url(),
});

const clientSchema = sharedSchema.extend({
  BUYER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export function loadSharedConfig(env = process.env) {
  return sharedSchema.parse(env);
}

export function loadClientConfig(env = process.env) {
  return clientSchema.parse(env);
}
