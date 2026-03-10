# x402-local-lab

Local TypeScript-first lab for x402 server/client integration.

## Structure

- `apps/x402-server`: Express server (currently with 402 placeholder response)
- `apps/x402-client`: client runner with signer abstraction
- `packages/signer`: `X402Signer` + viem adapter
- `packages/payment-core`: header parse/build helpers
- `packages/config`: env schema validation via zod
- `packages/types`: shared types

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm --filter @x402-local/server dev
pnpm --filter @x402-local/client dev
```

## Notes

This commit scaffolds architecture-aligned workspace and interfaces.
Actual `@x402/*` middleware/wrapper integration comes next.
