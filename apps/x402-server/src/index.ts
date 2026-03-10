import { config as loadDotenv } from "dotenv";
import path from "node:path";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { loadSharedConfig } from "@x402-local/config";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
const cfg = loadSharedConfig();

const app = express();
const facilitatorClient = new HTTPFacilitatorClient({ url: cfg.X402_FACILITATOR_URL });
const network = cfg.X402_NETWORK as `${string}:${string}`;
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  network,
  new ExactEvmScheme(),
);

app.use(
  paymentMiddleware(
    {
      "GET /premium/data": {
        accepts: [
          {
            scheme: "exact",
            price: cfg.X402_PRICE_USD,
            network,
            payTo: cfg.X402_SELLER_PAYTO,
          },
        ],
        description: "Premium x402-protected JSON",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/premium/data", (_req, res) => {
  res.json({
    data: {
      message: "x402 payment succeeded",
      timestamp: new Date().toISOString(),
    },
  });
});

const port = Number(process.env.PORT ?? 4020);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () => {
  console.log(`[x402-server] listening on http://${host}:${port}`);
});
