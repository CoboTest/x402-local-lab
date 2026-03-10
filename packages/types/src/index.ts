export type Hex = `0x${string}`;

export type X402Network = `eip155:${number}` | string;

export interface PaymentRequiredHeader {
  raw: string;
}

export interface PaymentSignatureHeader {
  raw: string;
}
