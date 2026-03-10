import express from "express";
import { loadSharedConfig } from "@x402-local/config";

const config = loadSharedConfig();
const app = express();
const port = 4020;

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/premium/data", (_req, res) => {
  // TODO: replace with @x402/express middleware integration in next commit
  res.status(402).setHeader("PAYMENT-REQUIRED", JSON.stringify({
    scheme: "exact",
    network: config.X402_NETWORK,
    payTo: config.X402_SELLER_PAYTO,
    price: config.X402_PRICE_USD,
  })).json({ error: "Payment required" });
});

app.listen(port, () => {
  console.log(`[x402-server] listening on http://localhost:${port}`);
});
