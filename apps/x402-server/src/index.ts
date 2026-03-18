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

/**
 * Middleware: inject settlement result into JSON response body.
 *
 * Wraps res.end BEFORE paymentMiddleware. When paymentMiddleware flushes
 * the buffered response, it calls our wrapped res.end. At that point
 * PAYMENT-RESPONSE header is already set, so we can decode it and merge
 * settlement data into the JSON body.
 */
function injectSettlement(): express.RequestHandler {
  return (_req, res, next) => {
    const originalEnd = res.end.bind(res);
    (res as any).end = function (chunk?: any, ...args: any[]) {
      if (!chunk) return originalEnd(chunk, ...args);
      try {
        const body = JSON.parse(typeof chunk === "string" ? chunk : chunk.toString());

        // Inject PAYMENT-RESPONSE (settlement result) into 200 body
        const prHeader = res.getHeader("PAYMENT-RESPONSE");
        if (prHeader) {
          const settlement = JSON.parse(Buffer.from(String(prHeader), "base64").toString("utf8"));
          body.settlement = {
            success: settlement.success,
            transaction: settlement.transaction,
            network: settlement.network,
            payer: settlement.payer,
          };
        }

        // Inject PAYMENT-REQUIRED (decoded) into 402 body
        const reqHeader = res.getHeader("PAYMENT-REQUIRED");
        if (reqHeader) {
          const paymentRequired = JSON.parse(Buffer.from(String(reqHeader), "base64").toString("utf8"));
          body.paymentRequired = paymentRequired;
        }

        const newBody = JSON.stringify(body);
        res.setHeader("Content-Length", Buffer.byteLength(newBody));
        return originalEnd(newBody, ...args);
      } catch {
        // Not JSON or decode failed, pass through
        return originalEnd(chunk, ...args);
      }
    };
    next();
  };
}

/** Resolve price from ?amount= query param or env default */
function resolvePrice(context: any): string {
  const q = context.adapter?.getQueryParam?.("amount");
  const amount = Array.isArray(q) ? q[0] : q;
  if (amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
    return amount;
  }
  return cfg.X402_PRICE_USD;
}

function unpaidBody(description: string, network: string, asset: string, payTo: string) {
  return async (context: any) => {
    const price = resolvePrice(context);
    return {
      contentType: "application/json",
      body: {
        error: "Payment required",
        description,
        price,
        network,
        asset,
        assetSymbol: "USDC",
        payTo,
        facilitator: cfg.X402_FACILITATOR_URL,
        hint: "Use ?amount=<USD> to set a custom price. Payment details are in the PAYMENT-REQUIRED response header (base64 JSON).",
      },
    };
  };
}

function unpaidBodyMulti(description: string) {
  return async (context: any) => {
    const price = resolvePrice(context);
    return {
      contentType: "application/json",
      body: {
        error: "Payment required",
        description,
        price,
        options: [
          { network: evmNetwork, asset: EVM_ASSET, assetSymbol: "USDC", payTo: cfg.X402_SELLER_PAYTO },
          { network: svmNetwork, asset: SVM_ASSET, assetSymbol: "USDC", payTo: cfg.X402_SVM_SELLER_PAYTO },
        ],
        facilitator: cfg.X402_FACILITATOR_URL,
        hint: "This resource supports both EVM and SVM payments. Pick one to proceed. Use ?amount=<USD> to set a custom price.",
      },
    };
  };
}

const EVM_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SVM_ASSET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const routes: Record<string, any> = {
  "GET /premium/evm": {
    accepts: [{ scheme: "exact", price: resolvePrice, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO }],
    description: "Premium x402-protected JSON (EVM)",
    mimeType: "application/json",
    unpaidResponseBody: unpaidBody("Premium x402-protected JSON (EVM)", evmNetwork, EVM_ASSET, cfg.X402_SELLER_PAYTO),
  },
  "GET /premium/svm": {
    accepts: [{ scheme: "exact", price: resolvePrice, network: svmNetwork, asset: SVM_ASSET, payTo: cfg.X402_SVM_SELLER_PAYTO }],
    description: "Premium x402-protected JSON (SVM)",
    mimeType: "application/json",
    unpaidResponseBody: unpaidBody("Premium x402-protected JSON (SVM)", svmNetwork, SVM_ASSET, cfg.X402_SVM_SELLER_PAYTO),
  },
  "GET /premium/multi": {
    accepts: [
      { scheme: "exact", price: resolvePrice, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO },
      { scheme: "exact", price: resolvePrice, network: svmNetwork, asset: SVM_ASSET, payTo: cfg.X402_SVM_SELLER_PAYTO },
    ],
    description: "Premium x402-protected JSON (Multi-chain)",
    mimeType: "application/json",
    unpaidResponseBody: unpaidBodyMulti("Premium x402-protected JSON (Multi-chain)"),
  },
};

resourceServer.initialize().then(() => {
  console.log("[x402-server] resourceServer initialized");

  const evmKind = resourceServer.getSupportedKind(x402Version, evmNetwork, "exact");
  const svmKind = resourceServer.getSupportedKind(x402Version, svmNetwork, "exact");
  console.log(`[x402-server] EVM: ${evmKind ? "OK" : "NOT FOUND"}, SVM: ${svmKind ? "OK" : "NOT FOUND"}`);

  const app = express();

  // 1) Inject settlement data into response body (wraps res.end BEFORE paymentMiddleware)
  app.use(injectSettlement());

  // 2) x402 payment middleware
  app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, false));

  // 3) Routes
  app.get("/health", (_req, res) => { res.json({ ok: true }); });

  app.get("/premium/evm", (req, res) => {
    const price = (req.query.amount as string) || cfg.X402_PRICE_USD;
    res.json({
      data: {
        message: "x402 EVM payment succeeded",
        timestamp: new Date().toISOString(),
        price,
        network: evmNetwork,
        payTo: cfg.X402_SELLER_PAYTO,
        asset: EVM_ASSET,
        assetSymbol: "USDC",
        facilitator: cfg.X402_FACILITATOR_URL,
      },
    });
  });

  app.get("/premium/svm", (req, res) => {
    const price = (req.query.amount as string) || cfg.X402_PRICE_USD;
    res.json({
      data: {
        message: "x402 SVM payment succeeded",
        timestamp: new Date().toISOString(),
        price,
        network: svmNetwork,
        payTo: cfg.X402_SVM_SELLER_PAYTO,
        asset: SVM_ASSET,
        assetSymbol: "USDC",
        facilitator: cfg.X402_FACILITATOR_URL,
      },
    });
  });

  app.get("/premium/multi", (req, res) => {
    const price = (req.query.amount as string) || cfg.X402_PRICE_USD;
    res.json({
      data: {
        message: "x402 Multi-chain payment succeeded",
        timestamp: new Date().toISOString(),
        price,
        info: "This resource was unlocked using either EVM or SVM payment.",
        facilitator: cfg.X402_FACILITATOR_URL,
      },
    });
  });

  const port = Number(process.env.PORT ?? 4020);
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    console.log(`[x402-server] listening on http://${host}:${port}`);
  });
}).catch((err: any) => {
  console.error("[x402-server] init failed:", err.message);
  process.exit(1);
});
