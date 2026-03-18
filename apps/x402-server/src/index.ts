import { config as loadDotenv } from "dotenv";
import path from "node:path";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Version } from "@x402/core";
import { loadSharedConfig } from "@x402-local/config";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
const cfg = loadSharedConfig();

const evmNetwork = cfg.X402_NETWORK as `${string}:${string}`;
const svmNetwork = cfg.X402_SVM_NETWORK as `${string}:${string}`;

const facilitatorClient = new HTTPFacilitatorClient({ url: cfg.X402_FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(evmNetwork, new ExactEvmScheme())
  .register(svmNetwork, new ExactSvmScheme());

const routes: Record<string, any> = {
  "GET /premium/evm": {
    accepts: [{ scheme: "exact", price: cfg.X402_PRICE_USD, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO }],
    description: "Premium x402-protected JSON (EVM)",
    mimeType: "application/json",
  },
};

if (cfg.X402_SVM_SELLER_PAYTO) {
  routes["GET /premium/svm"] = {
    accepts: [{ scheme: "exact", price: cfg.X402_PRICE_USD, network: svmNetwork, asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", payTo: cfg.X402_SVM_SELLER_PAYTO }],
    description: "Premium x402-protected JSON (SVM)",
    mimeType: "application/json",
  };
}

resourceServer.initialize().then(() => {
  console.log("[x402-server] resourceServer initialized");

  const evmKind = resourceServer.getSupportedKind(x402Version, evmNetwork, "exact");
  const svmKind = resourceServer.getSupportedKind(x402Version, svmNetwork, "exact");
  console.log(`[x402-server] EVM kind: ${evmKind ? "OK" : "NOT FOUND"}, SVM kind: ${svmKind ? "OK" : "NOT FOUND"}`);

  const app = express();
  app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, false));

  app.get("/health", (_req, res) => { res.json({ ok: true }); });

  app.get("/premium/evm", (_req, res) => {
    res.json({
      data: {
        message: "x402 EVM payment succeeded",
        timestamp: new Date().toISOString(),
        price: cfg.X402_PRICE_USD,
        network: evmNetwork,
        payTo: cfg.X402_SELLER_PAYTO,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        assetSymbol: "USDC",
        facilitator: cfg.X402_FACILITATOR_URL,
      },
    });
  });

  app.get("/premium/svm", (_req, res) => {
    res.json({
      data: {
        message: "x402 SVM payment succeeded",
        timestamp: new Date().toISOString(),
        price: cfg.X402_PRICE_USD,
        network: svmNetwork,
        payTo: cfg.X402_SVM_SELLER_PAYTO,
        asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        assetSymbol: "USDC",
        facilitator: cfg.X402_FACILITATOR_URL,
      },
    });
  });

  const port = Number(process.env.PORT ?? 4020);
  const host = process.env.HOST ?? "0.0.0.0";
  app.listen(port, host, () => {
    console.log(`[x402-server] listening on http://${host}:${port}`);
  });
}).catch((err: any) => {
  console.error("[x402-server] init failed:", err.message);
  process.exit(1);
});
