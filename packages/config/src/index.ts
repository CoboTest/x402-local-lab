import { z } from "zod";

// Match EVM (0x...) or Solana base58 addresses
const evmOrSolanaAddress = z.string().regex(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/);

const sharedSchema = z.object({
  X402_NETWORK: z.string().min(1),
  X402_FACILITATOR_URL: z.string().url(),
  X402_SELLER_PAYTO: evmOrSolanaAddress,
  X402_PRICE_USD: z.string().min(1),
  RPC_URL: z.string().url(),
  // SVM optional fields
  X402_SVM_SELLER_PAYTO: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).optional(),
  SOLANA_PRIVATE_KEY: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/).optional(),
  X402_SVM_NETWORK: z.string().min(1).default("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
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
