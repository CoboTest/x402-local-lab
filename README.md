# x402-local-lab

x402 协议本地测试环境。TypeScript monorepo，包含 EVM（Base Sepolia）和 SVM（Solana Devnet）双链支付服务端与客户端。

## 项目结构

```
apps/
  x402-server/    Express server，x402 paywall middleware
  x402-client/    fetch client，自动 402→签名→重试
packages/
  config/         env schema 校验（zod）
  signer/         签名抽象接口
  types/          共享类型
  payment-core/   支付辅助（预留）
docs/
  reports/        运行报告（JSON + Markdown）
```

## 环境要求

- Node.js >= 22
- pnpm >= 9

## Server 启动

### 1. 安装依赖

```bash
git clone https://github.com/CoboTest/x402-local-lab.git
cd x402-local-lab
pnpm install
```

### 2. 配置 `.env`

```bash
cp .env.example .env
```

编辑 `.env`，填入你的地址：

```env
# === Server Config (required) ===
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=https://www.x402.org/facilitator
X402_SELLER_PAYTO=0xYOUR_BASE_SEPOLIA_ADDRESS
X402_PRICE_USD=0.001
RPC_URL=https://sepolia.base.org
X402_SVM_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
X402_SVM_SELLER_PAYTO=YOUR_SOLANA_DEVNET_ADDRESS
```

> ⚠️ Facilitator URL 必须带 `www.`（`https://www.x402.org/facilitator`），不带会 308 重定向导致静默失败。

### 3. 启动

```bash
pnpm --filter @x402-local/server run dev
```

Server 默认监听 `0.0.0.0:4020`。设置 `HOST=127.0.0.1` 可限制仅本机访问。

### 4. 验证

```bash
# 健康检查
curl http://localhost:4020/health
# {"ok":true}

# EVM 路由（402 Payment Required）
curl http://localhost:4020/premium/evm
# 返回支付信息 + paymentRequired 解码数据

# SVM 路由
curl http://localhost:4020/premium/svm

# 自定义价格
curl "http://localhost:4020/premium/evm?amount=0.01"
```

### Server 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/premium/evm` | GET | EVM 付费资源（Base Sepolia USDC） |
| `/premium/svm` | GET | SVM 付费资源（Solana Devnet USDC） |
| `/premium/multi`| GET | 多链付费资源（EVM 或 SVM 均可） |

**Query 参数**：
- `?amount=<USD>` — 动态设置价格（如 `?amount=0.01` = 0.01 USDC）

**402 Response**：Body 包含人类可读的支付信息 + `paymentRequired` 字段（PAYMENT-REQUIRED header 的 JSON 解码）

**200 Response**：Body 包含业务数据 + `settlement` 字段（txHash、payer、network）

## Client 启动

### 1. 配置 `.env`（补充 client 字段）

```env
# EVM client
BUYER_PRIVATE_KEY=0xYOUR_TEST_PRIVATE_KEY
RESOURCE_SERVER_URL=http://localhost:4020/premium/evm

# SVM client（可选）
SOLANA_PRIVATE_KEY=YOUR_SOLANA_BASE58_SECRET_KEY
SVM_RESOURCE_URL=http://localhost:4020/premium/svm
```

> ⚠️ 私钥仅用于测试网。确保 Base Sepolia 账户有 ETH（gas）和 USDC，Solana Devnet 账户有 USDC。

### 2. 获取测试代币

**Base Sepolia**：
- ETH faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
- USDC faucet: https://faucet.circle.com/（选 Base Sepolia）

**Solana Devnet**：
- SOL faucet: https://faucet.solana.com/
- USDC faucet: https://faucet.circle.com/（选 Solana Devnet）

### 3. 运行 EVM client

```bash
# 简单运行（发起支付并打印结果）
pnpm --filter @x402-local/client run dev

# 完整报告（生成 JSON + Markdown 到 docs/reports/）
pnpm --filter @x402-local/client run evm:report
```

### 4. 运行 SVM client

```bash
# 简单运行
pnpm --filter @x402-local/client run svm:run

# 完整报告
pnpm --filter @x402-local/client run svm:report
```

## 协议概览

```
Client                    Server                   Facilitator         Chain
  |                         |                         |                  |
  |--- GET /premium/evm --->|                         |                  |
  |<-- 402 + PAYMENT-REQUIRED                         |                  |
  |                         |                         |                  |
  |  [构造签名]              |                         |                  |
  |                         |                         |                  |
  |--- GET + PAYMENT-SIGNATURE -->|                   |                  |
  |                         |--- verify ------------->|                  |
  |                         |<-- isValid=true --------|                  |
  |                         |--- settle ------------->|                  |
  |                         |                         |--- tx ---------> |
  |                         |<-- success + txHash ----|                  |
  |<-- 200 + PAYMENT-RESPONSE + body                  |                  |
```

- EVM：EIP-712 签名 + EIP-3009 `TransferWithAuthorization`
- SVM：Solana Transaction 签名 + SPL Token `TransferChecked`
- Gas 由 facilitator 代付（EVM + SVM），buyer 只需持有 USDC

## 相关文档

- [x402 协议规范](https://github.com/coinbase/x402)
- [EVM exact scheme](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md)
- [SVM exact scheme](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md)
- [x402 官方文档](https://docs.x402.org)
- [CDP Facilitator 网络支持](https://docs.cdp.coinbase.com/x402/network-support)
