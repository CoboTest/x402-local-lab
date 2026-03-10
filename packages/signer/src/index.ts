import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "@x402-local/types";

export interface X402Signer {
  address: Hex;
  signHash?(hash: Hex): Promise<Hex>;
  signTypedData?(params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

export function createViemSigner(privateKey: Hex): X402Signer {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async signHash(hash: Hex) {
      return account.sign({ hash });
    },
    async signTypedData(params) {
      return account.signTypedData(params as never);
    },
  };
}
