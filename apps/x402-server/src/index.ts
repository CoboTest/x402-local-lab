import { config as loadDotenv } from "dotenv";
import path from "node:path";
import express from "express";
import {
  paymentMiddlewareFromHTTPServer,
  x402ResourceServer,
  x402HTTPResourceServer,
} from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Version } from "@x402/core";
import {
  declareSIWxExtension,
  siwxResourceServerExtension,
  createSIWxSettleHook,
  createSIWxRequestHook,
  InMemorySIWxStorage,
} from "@x402/extensions/sign-in-with-x";
import { loadSharedConfig } from "@x402-local/config";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });
const cfg = loadSharedConfig();

const evmNetwork = cfg.X402_NETWORK as `${string}:${string}`;
const svmNetwork = cfg.X402_SVM_NETWORK as `${string}:${string}`;

const siwxStorage = new InMemorySIWxStorage();

const facilitatorClient = new HTTPFacilitatorClient({ url: cfg.X402_FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(evmNetwork, new ExactEvmScheme())
  .register(svmNetwork, new ExactSvmScheme())
  .registerExtension(siwxResourceServerExtension)
  .onAfterSettle(createSIWxSettleHook({
    storage: siwxStorage,
    onEvent: (event) => {
      console.log(`[SIWX-settle] ${event.type} | resource=${event.resource} | address=${event.address}`);
    },
  }));

// --- Helpers ---
function injectSettlement(): express.RequestHandler {
  return (_req, res, next) => {
    const originalEnd = res.end.bind(res);
    (res as any).end = function (chunk?: any, ...args: any[]) {
      if (!chunk) return originalEnd(chunk, ...args);
      try {
        const body = JSON.parse(typeof chunk === "string" ? chunk : chunk.toString());
        const prHeader = res.getHeader("PAYMENT-RESPONSE");
        if (prHeader) {
          const s = JSON.parse(Buffer.from(String(prHeader), "base64").toString("utf8"));
          body.settlement = { success: s.success, transaction: s.transaction, network: s.network, payer: s.payer };
        }
        const reqHeader = res.getHeader("PAYMENT-REQUIRED");
        if (reqHeader) {
          body.paymentRequired = JSON.parse(Buffer.from(String(reqHeader), "base64").toString("utf8"));
        }
        const newBody = JSON.stringify(body);
        res.setHeader("Content-Length", Buffer.byteLength(newBody));
        return originalEnd(newBody, ...args);
      } catch { return originalEnd(chunk, ...args); }
    };
    next();
  };
}

function resolvePrice(context: any): string {
  const q = context.adapter?.getQueryParam?.("amount");
  const amount = Array.isArray(q) ? q[0] : q;
  if (amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0) return amount;
  return cfg.X402_PRICE_USD;
}

function unpaidBody(description: string, network: string, asset: string, payTo: string) {
  return async (context: any) => ({
    contentType: "application/json",
    body: {
      error: "Payment required", description, price: resolvePrice(context),
      network, asset, assetSymbol: "USDC", payTo,
      facilitator: cfg.X402_FACILITATOR_URL,
      hint: "Use ?amount=<USD> to set a custom price.",
    },
  });
}

function unpaidBodyMulti(description: string) {
  return async (context: any) => ({
    contentType: "application/json",
    body: {
      error: "Payment required", description, price: resolvePrice(context),
      options: [
        { network: evmNetwork, asset: EVM_ASSET, assetSymbol: "USDC", payTo: cfg.X402_SELLER_PAYTO },
        { network: svmNetwork, asset: SVM_ASSET, assetSymbol: "USDC", payTo: cfg.X402_SVM_SELLER_PAYTO },
      ],
      facilitator: cfg.X402_FACILITATOR_URL,
    },
  });
}

const EVM_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SVM_ASSET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// ========================================
// Routes: /premium/* = pay-per-request only
// Routes: /siwx/*    = pay + SIWX re-access
// ========================================
const routes: Record<string, any> = {
  // --- Pay-per-request (no SIWX) ---
  "GET /premium/evm": {
    accepts: [{ scheme: "exact", price: resolvePrice, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO }],
    description: "Premium x402-protected JSON (EVM, pay-per-request)",
    mimeType: "application/json",
    unpaidResponseBody: unpaidBody("Premium JSON (EVM, pay-per-request)", evmNetwork, EVM_ASSET, cfg.X402_SELLER_PAYTO),
  },
  "GET /premium/svm": {
    accepts: [{ scheme: "exact", price: resolvePrice, network: svmNetwork, asset: SVM_ASSET, payTo: cfg.X402_SVM_SELLER_PAYTO }],
    description: "Premium x402-protected JSON (SVM, pay-per-request)",
    mimeType: "application/json",
    unpaidResponseBody: unpaidBody("Premium JSON (SVM, pay-per-request)", svmNetwork, SVM_ASSET, cfg.X402_SVM_SELLER_PAYTO),
  },
  "GET /premium/multi": {
    accepts: [
      { scheme: "exact", price: resolvePrice, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO },
      { scheme: "exact", price: resolvePrice, network: svmNetwork, asset: SVM_ASSET, payTo: cfg.X402_SVM_SELLER_PAYTO },
    ],
    description: "Premium x402-protected JSON (Multi-chain, pay-per-request)",
    mimeType: "application/json",
    unpaidResponseBody: unpaidBodyMulti("Premium JSON (Multi-chain, pay-per-request)"),
  },

  // --- SIWX: pay once + wallet re-auth ---
  "GET /siwx/evm": {
    accepts: [{ scheme: "exact", price: resolvePrice, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO }],
    description: "Premium JSON (EVM, SIWX enabled)",
    mimeType: "application/json",
    extensions: declareSIWxExtension({ statement: "Sign in to access purchased content (EVM)" }),
    unpaidResponseBody: unpaidBody("Premium JSON (EVM, SIWX enabled)", evmNetwork, EVM_ASSET, cfg.X402_SELLER_PAYTO),
  },
  "GET /siwx/svm": {
    accepts: [{ scheme: "exact", price: resolvePrice, network: svmNetwork, asset: SVM_ASSET, payTo: cfg.X402_SVM_SELLER_PAYTO }],
    description: "Premium JSON (SVM, SIWX enabled)",
    mimeType: "application/json",
    extensions: declareSIWxExtension({ statement: "Sign in to access purchased content (SVM)" }),
    unpaidResponseBody: unpaidBody("Premium JSON (SVM, SIWX enabled)", svmNetwork, SVM_ASSET, cfg.X402_SVM_SELLER_PAYTO),
  },
  "GET /siwx/multi": {
    accepts: [
      { scheme: "exact", price: resolvePrice, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO },
      { scheme: "exact", price: resolvePrice, network: svmNetwork, asset: SVM_ASSET, payTo: cfg.X402_SVM_SELLER_PAYTO },
    ],
    description: "Premium JSON (Multi-chain, SIWX enabled)",
    mimeType: "application/json",
    extensions: declareSIWxExtension({ statement: "Sign in to access purchased content (Multi-chain)" }),
    unpaidResponseBody: unpaidBodyMulti("Premium JSON (Multi-chain, SIWX enabled)"),
  },

  // --- Auth-only: wallet signature only, no payment ---
  "GET /siwx/profile": {
    accepts: [],
    description: "Wallet-gated profile (auth-only, no payment)",
    mimeType: "application/json",
    extensions: declareSIWxExtension({
      network: evmNetwork,
      statement: "Sign in with your wallet to view your profile",
      expirationSeconds: 300,
    }),
  },
};

// Wrap the SIWX request hook to catch and log the actual error
const originalSiwxHook = createSIWxRequestHook({
  storage: siwxStorage,
  onEvent: (event) => {
    console.log(`[SIWX] ${event.type} | resource=${event.resource} | address=${(event as any).address ?? "N/A"} | error=${(event as any).error ?? "N/A"}`);
  },
});

const httpServer = new x402HTTPResourceServer(resourceServer, routes)
  .onProtectedRequest(async (context, routeConfig) => {
    const header = context.adapter.getHeader("SIGN-IN-WITH-X") || context.adapter.getHeader("sign-in-with-x");
    if (header) {
      try {
        const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
        console.log(`[SIWX-debug] Incoming payload: nonce=${decoded.nonce} address=${decoded.address} issuedAt=${decoded.issuedAt}`);

        // Manual validation to see exactly what fails
        const { parseSIWxHeader, validateSIWxMessage, verifySIWxSignature } = await import("@x402/extensions/sign-in-with-x");
        const payload = parseSIWxHeader(header);
        console.log(`[SIWX-debug] Parsed OK, address=${payload.address}`);

        const resourceUri = context.adapter.getUrl();
        console.log(`[SIWX-debug] Validating against resourceUri=${resourceUri}`);
        const validation = await validateSIWxMessage(payload, resourceUri);
        console.log(`[SIWX-debug] Validation: valid=${validation.valid} error=${(validation as any).error ?? "none"}`);

        if (validation.valid) {
          try {
            const verification = await verifySIWxSignature(payload);
            console.log(`[SIWX-debug] Verification: valid=${verification.valid} address=${(verification as any).address ?? "N/A"} error=${(verification as any).error ?? "none"}`);

            if (verification.valid) {
              const hasPaid = await siwxStorage.hasPaid(context.path, (verification as any).address);
              console.log(`[SIWX-debug] hasPaid(${context.path}, ${(verification as any).address}) = ${hasPaid}`);
            }
          } catch (verifyErr: any) {
            console.log(`[SIWX-debug] verifySIWxSignature threw: ${JSON.stringify(verifyErr)}`);
            console.log(`[SIWX-debug] typeof=${typeof verifyErr} keys=${verifyErr ? Object.keys(verifyErr) : "null"}`);
          }
        }
      } catch (e: any) {
        console.log(`[SIWX-debug] Manual check error: ${JSON.stringify(e)} typeof=${typeof e}`);
      }
    }
    return originalSiwxHook(context, routeConfig);
  });

resourceServer.initialize().then(() => {
  console.log("[x402-server] resourceServer initialized");
  const evmKind = resourceServer.getSupportedKind(x402Version, evmNetwork, "exact");
  const svmKind = resourceServer.getSupportedKind(x402Version, svmNetwork, "exact");
  console.log(`[x402-server] EVM: ${evmKind ? "OK" : "NOT FOUND"}, SVM: ${svmKind ? "OK" : "NOT FOUND"}`);
  console.log("[x402-server] Routes: /premium/* (pay-per-request) | /siwx/* (SIWX enabled)");

  const app = express();

  // Request logging
  app.use((req, _res, next) => {
    const hasSiwx = !!req.headers["sign-in-with-x"];
    const hasPayment = !!(req.headers["payment-signature"] || req.headers["x-payment"]);
    console.log(`[REQ] ${req.method} ${req.path} | SIWX=${hasSiwx} | Payment=${hasPayment}`);
    next();
  });

  app.use(injectSettlement());
  app.use(paymentMiddlewareFromHTTPServer(httpServer, undefined, undefined, false));

  app.get("/health", (_req, res) => { res.json({ ok: true }); });
  app.get("/debug/siwx", (_req, res) => {
    const map = (siwxStorage as any).paidAddresses as Map<string, Set<string>> | undefined;
    const entries: Record<string, string[]> = {};
    if (map) {
      for (const [addr, resources] of map) {
        entries[addr] = [...resources];
      }
    }
    res.json({ info: "In-memory SIWX paid wallets", paidAddresses: entries });
  });

  // --- Pay-per-request handlers ---
  app.get("/premium/evm", (req, res) => {
    res.json({ data: { message: "x402 EVM payment succeeded", timestamp: new Date().toISOString(), price: (req.query.amount as string) || cfg.X402_PRICE_USD, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO, asset: EVM_ASSET, assetSymbol: "USDC", facilitator: cfg.X402_FACILITATOR_URL } });
  });
  app.get("/premium/svm", (req, res) => {
    res.json({ data: { message: "x402 SVM payment succeeded", timestamp: new Date().toISOString(), price: (req.query.amount as string) || cfg.X402_PRICE_USD, network: svmNetwork, payTo: cfg.X402_SVM_SELLER_PAYTO, asset: SVM_ASSET, assetSymbol: "USDC", facilitator: cfg.X402_FACILITATOR_URL } });
  });
  app.get("/premium/multi", (req, res) => {
    res.json({ data: { message: "x402 Multi-chain payment succeeded", timestamp: new Date().toISOString(), price: (req.query.amount as string) || cfg.X402_PRICE_USD, facilitator: cfg.X402_FACILITATOR_URL } });
  });

  // --- SIWX handlers ---
  app.get("/siwx/evm", (req, res) => {
    res.json({ data: { message: "x402 EVM access granted (payment or SIWX re-auth)", timestamp: new Date().toISOString(), price: (req.query.amount as string) || cfg.X402_PRICE_USD, network: evmNetwork, payTo: cfg.X402_SELLER_PAYTO, asset: EVM_ASSET, assetSymbol: "USDC", facilitator: cfg.X402_FACILITATOR_URL } });
  });
  app.get("/siwx/svm", (req, res) => {
    res.json({ data: { message: "x402 SVM access granted (payment or SIWX re-auth)", timestamp: new Date().toISOString(), price: (req.query.amount as string) || cfg.X402_PRICE_USD, network: svmNetwork, payTo: cfg.X402_SVM_SELLER_PAYTO, asset: SVM_ASSET, assetSymbol: "USDC", facilitator: cfg.X402_FACILITATOR_URL } });
  });
  app.get("/siwx/multi", (req, res) => {
    res.json({ data: { message: "x402 Multi-chain access granted (payment or SIWX re-auth)", timestamp: new Date().toISOString(), price: (req.query.amount as string) || cfg.X402_PRICE_USD, facilitator: cfg.X402_FACILITATOR_URL } });
  });
  app.get("/siwx/profile", (_req, res) => {
    res.json({ data: { message: "Welcome! Wallet authenticated (no payment needed).", timestamp: new Date().toISOString(), note: "Auth-only route. SIWX signature verified, no USDC charged." } });
  });

  const port = Number(process.env.PORT ?? 4020);
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => { console.log(`[x402-server] listening on http://${host}:${port}`); });
}).catch((err: any) => { console.error("[x402-server] init failed:", err.message); process.exit(1); });
