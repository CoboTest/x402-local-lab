import fs from "node:fs";
import path from "node:path";

const defaultFacilitators = [
  "https://x402.org/facilitator",
  "https://facilitator.payai.network",
  "https://facilitator.corbits.dev",
];

function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

function isTestnet(network: string) {
  const n = network.toLowerCase();
  const knownTestIds = new Set([
    "eip155:84532", // base sepolia
    "eip155:43113", // avalanche fuji
    "eip155:80002", // polygon amoy
    "eip155:713715", // sei testnet
    "eip155:324705682", // skale base sepolia
    "eip155:1952", // xlayer testnet
    "solana:etwtrabzayq6imfeykouru166vu2xqa1", // solana devnet
    "stellar:testnet",
    "aptos:2",
  ]);
  return (
    knownTestIds.has(n) ||
    n.includes("sepolia") ||
    n.includes("devnet") ||
    n.includes("testnet") ||
    n.includes("amoy") ||
    n.includes("fuji")
  );
}

function networkDisplayName(network: string) {
  const n = network.toLowerCase();
  const map: Record<string, string> = {
    "eip155:84532": "Base Sepolia",
    "eip155:8453": "Base",
    "eip155:43114": "Avalanche",
    "eip155:43113": "Avalanche Fuji",
    "eip155:137": "Polygon",
    "eip155:80002": "Polygon Amoy",
    "eip155:1329": "Sei",
    "eip155:713715": "Sei Testnet",
    "eip155:1187947933": "SKALE Base",
    "eip155:324705682": "SKALE Base Sepolia",
    "eip155:196": "X Layer",
    "eip155:1952": "X Layer Testnet",
    "eip155:3338": "Peaq",
    "eip155:4689": "IoTeX",
    "eip155:143": "Monad",
    "eip155:10143": "Monad Testnet",
    "solana:5eykt4usfv8p8njdtrepy1vzqkqzkvdp": "Solana Mainnet",
    "solana:etwtrabzayq6imfeykouru166vu2xqa1": "Solana Devnet",
    "stellar:testnet": "Stellar Testnet",
    "aptos:2": "Aptos Testnet",
    "v1:base": "Base",
    "v1:base-sepolia": "Base Sepolia",
    "v1:avalanche": "Avalanche",
    "v1:avalanche-fuji": "Avalanche Fuji",
    "v1:polygon": "Polygon",
    "v1:polygon-amoy": "Polygon Amoy",
    "v1:sei": "Sei",
    "v1:sei-testnet": "Sei Testnet",
    "v1:xlayer": "X Layer",
    "v1:xlayer-testnet": "X Layer Testnet",
    "v1:solana": "Solana Mainnet",
    "v1:solana-mainnet-beta": "Solana Mainnet",
    "v1:solana-devnet": "Solana Devnet",
    "v1:skale-base": "SKALE Base",
    "v1:skale-base-sepolia": "SKALE Base Sepolia",
    "v1:peaq": "Peaq",
    "v1:iotex": "IoTeX",
    "v1:monad": "Monad",
    "v1:monad-testnet": "Monad Testnet",
  };
  return map[n] || map[`v1:${n}`] || network;
}

function shortName(url: string) {
  try {
    const h = new URL(url).hostname;
    if (h === "x402.org") return "x402.org";
    if (h === "facilitator.payai.network") return "PayAI";
    if (h === "facilitator.corbits.dev") return "Corbits";
    return h;
  } catch {
    return url;
  }
}

async function fetchSupported(url: string) {
  const endpoint = `${url.replace(/\/$/, "")}/supported`;
  try {
    const res = await fetch(endpoint, {
      headers: { "content-type": "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        facilitator: url,
        ok: false,
        status: res.status,
        error: text.slice(0, 300),
      };
    }
    const json = JSON.parse(text);
    return {
      facilitator: url,
      ok: true,
      kinds: Array.isArray(json?.kinds) ? json.kinds : [],
      extensions: Array.isArray(json?.extensions) ? json.extensions : [],
      signers: json?.signers ?? {},
    };
  } catch (e: any) {
    return {
      facilitator: url,
      ok: false,
      status: 0,
      error: e?.message ?? String(e),
    };
  }
}

function buildUnifiedRows(results: any[]) {
  const rows = new Map<string, any>();

  for (const r of results) {
    const col = shortName(r.facilitator);
    if (!r.ok) continue;
    for (const k of r.kinds || []) {
      const key = `v${k.x402Version}:${k.network}`;
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          version: `v${k.x402Version}`,
          network: k.network,
          networkName: networkDisplayName(k.network),
          env: isTestnet(k.network) ? "测试网" : "主网",
          support: {},
        });
      }
      rows.get(key).support[col] = k.scheme ?? "exact";
    }
  }

  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function markdownMatrixZh(results: any[]) {
  const lines: string[] = [];
  lines.push("# x402 Facilitator 统一网络矩阵（中文）");
  lines.push("");
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push("");

  const cols = results.map(r => shortName(r.facilitator));
  const rows = buildUnifiedRows(results);

  lines.push("## 统一支持表（每列一个 Facilitator，每行一个网络）");
  lines.push("");
  lines.push(`| 网络(v:network) | 网络名称 | 环境 | ${cols.join(" | ")} |`);
  lines.push(`|---|---|---|${cols.map(() => "---").join("|")}|`);

  for (const row of rows) {
    const cells = cols.map(c => (row.support[c] ? `✅ ${row.support[c]}` : "—"));
    lines.push(`| ${row.key} | ${row.networkName} | ${row.env} | ${cells.join(" | ")} |`);
  }

  lines.push("");
  lines.push("## Facilitator 状态");
  for (const r of results) {
    const name = shortName(r.facilitator);
    if (!r.ok) {
      lines.push(`- ${name}: ❌ 失败 (${r.status}) - ${r.error}`);
    } else {
      const kinds = r.kinds || [];
      const testCount = kinds.filter((k: any) => isTestnet(k.network)).length;
      const mainCount = kinds.length - testCount;
      lines.push(`- ${name}: ✅ 成功 | kinds=${kinds.length} | 主网=${mainCount} | 测试网=${testCount}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const arg = process.argv[2];
  const facilitators = arg
    ? arg.split(",").map(s => s.trim()).filter(Boolean)
    : defaultFacilitators;

  const results = await Promise.all(facilitators.map(fetchSupported));

  const outDir = path.resolve(process.cwd(), "../../docs/reports");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "facilitators-matrix.json");
  const mdPath = path.join(outDir, "facilitators-matrix.zh.md");

  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  fs.writeFileSync(mdPath, markdownMatrixZh(results));

  console.log(JSON.stringify({ facilitators, jsonPath, mdPath }, null, 2));
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
