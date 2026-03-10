# x402-local-lab 架构设计（评审版 v1）

## 1. 背景与目标

本项目用于在本地构建并验证一个基于 x402 协议的最小可用闭环：

- Client 请求受保护资源
- Server 返回 HTTP 402 + `PAYMENT-REQUIRED`
- Client 自动签名支付信息并重试请求
- Server 完成 verify/settle 后返回 200 + 业务数据

定位：

- **先跑通协议闭环，再做业务扩展**
- **TypeScript-first**，优先对齐 x402 官方 JS/TS 生态
- 设计上保持 signer 可插拔，避免绑定单一钱包实现

---

## 2. 非目标（当前阶段不做）

- 不做前端 UI（先 CLI 与 HTTP API）
- 不做生产级多租户计费
- 不做复杂风控/限额系统
- 不做链上历史索引服务

---

## 3. 技术选型

- 运行时：Node.js 22+
- 语言：TypeScript
- 包管理：pnpm workspace
- Server：Express + `@x402/express`
- Client：`@x402/fetch` + 原生 fetch
- 签名：viem（通过 adapter 接入）
- 配置校验：zod
- 测试：vitest（后续加入）

网络默认：

- Base Sepolia（开发）
- Facilitator 默认使用官方地址（开发）

---

## 4. Monorepo 结构

```text
x402-local-lab/
├─ apps/
│  ├─ x402-server/            # 受保护资源服务
│  └─ x402-client/            # 请求与自动支付客户端（CLI）
├─ packages/
│  ├─ types/                  # 共享类型定义
│  ├─ config/                 # 环境变量与配置 schema
│  ├─ signer/                 # signer 抽象与 viem adapter
│  └─ payment-core/           # 402 解析、签名载荷拼装、header 构造
├─ docs/
│  └─ architecture-review-v1.md
└─ infra/                     # 可选（anvil/otel/docker-compose）
```

---

## 5. 模块职责

### 5.1 Server（apps/x402-server）

职责：

- 暴露受保护业务接口（例如 `GET /premium/data`）
- 集成 x402 middleware
- 基于路由和策略返回 402 challenge
- 在支付信息有效后返回业务数据

关键边界：

- Server 只负责“验证与结算流程接入”
- 不持有 Buyer 私钥
- 业务 handler 不感知具体签名逻辑

### 5.2 Client（apps/x402-client）

职责：

- 发起请求并识别 402
- 解析 `PAYMENT-REQUIRED`
- 根据策略选择可支付方案（scheme/network/token）
- 调用 signer 产出签名
- 添加 `PAYMENT-SIGNATURE` 后自动重试

关键边界：

- 私钥只存在于 client 执行环境
- 重试次数受控（默认仅一次自动支付重试）

### 5.3 payment-core（packages/payment-core）

职责：

- 标准化 402 header 解析
- 支付载荷标准化（exact 为主）
- 构造签名输入（digest 或 typedData）
- 构造/序列化 `PAYMENT-SIGNATURE`

### 5.4 signer（packages/signer）

核心接口（建议）：

```ts
export type Hex = `0x${string}`;

export interface X402Signer {
  address: Hex;
  signHash?(hash: Hex): Promise<Hex>;
  signTypedData?(params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}
```

设计原则：

- 优先 `signTypedData`（EIP-712 语义更清晰）
- 协议明确要求固定 digest 时使用 `signHash`
- viem 仅作为 adapter，不渗透到业务层

---

## 6. 端到端时序

1. Client 请求 `GET /premium/data`
2. Server 返回 `402 Payment Required` + `PAYMENT-REQUIRED`
3. Client 解析 requirements，选定一条可支付规则
4. Client 组织签名 payload，调用 signer 产出签名
5. Client 携带 `PAYMENT-SIGNATURE` 重试原请求
6. Server verify + settle 成功后返回 `200 OK`
7. 可选：Server 返回 `PAYMENT-RESPONSE`（收据）

---

## 7. 配置与环境变量

建议 `.env` 字段：

- `X402_NETWORK`（如 `eip155:84532`）
- `X402_FACILITATOR_URL`
- `X402_SELLER_PAYTO`
- `X402_PRICE_USD`
- `RPC_URL`
- `BUYER_PRIVATE_KEY`（仅 client）

要求：

- 使用 zod 做启动期强校验
- 缺关键配置时 fail-fast 退出
- `.env.example` 必须不包含真实密钥

---

## 8. 错误处理与重试策略

- 对 402：进入支付流程，仅允许一次自动支付重试
- 对 4xx（参数不匹配、签名无效）：直接失败
- 对 facilitator 5xx/超时：指数退避，最多 2~3 次
- 记录 requestId 与重试轨迹，便于排查

---

## 9. 安全设计（MVP）

- Buyer 私钥只在 client 侧加载
- 签名内容必须绑定：金额、收款地址、网络、过期时间/nonce
- 预留 anti-replay（nonce + expiry）
- 日志脱敏：
  - 不打印私钥
  - 不打印完整原始签名 payload（必要时仅 hash）

---

## 10. 观测性

最小日志字段：

- `requestId`
- `route`
- `scheme`
- `network`
- `amount`
- `verifyLatencyMs`
- `settleLatencyMs`
- `result`

后续可扩展 metrics：

- 402 命中率
- 支付成功率
- settle 失败率
- P95 结算时延

---

## 11. 里程碑计划

- M1：PoC 跑通（单路由 402→支付→200）
- M2：Signer interface + viem adapter
- M3：配置 schema + 错误码 + 结构化日志
- M4：集成测试 + 文档化联调流程

---

## 12. 评审问题清单

1. server/client 与 payment-core 的分层是否清晰？
2. signer 是否足够可插拔（未来接 KMS/HSM）？
3. 402 自动重试是否有死循环风险？
4. facilitator 故障时系统是否有可预测降级行为？
5. replay/idempotency 方案是否满足当前阶段需求？
6. 配置校验与敏感信息管理是否可接受？
7. 本地与测试网切换是否无需改代码？

---

## 13. 后续实施建议

- 下一步创建 workspace 骨架与 `pnpm-workspace.yaml`
- 先实现最小 happy path，再补测试与失败路径
- 文档同步维护 `docs/integration-runbook.md`（联调命令+样例报文）

> 状态：Draft / For Review
