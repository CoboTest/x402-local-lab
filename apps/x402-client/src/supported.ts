import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

async function main() {
  const url = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
  const res = await fetch(`${url}/supported`, {
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`supported failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
