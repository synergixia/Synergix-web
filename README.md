# Synergix

**The world's first AI agent running on pure local AI, with its immortal memory sealed on Arweave via Irys.**  
Decentralized collective intelligence — 80% of every AI response is built from community knowledge that Irys seals permanently on-chain. No third-party AI APIs: Synergix thinks on a self-hosted local model.

🌐 [synergix.lol](https://www.synergix.lol) · 🤖 [Telegram Bot](https://t.me/synergix_ai_bot) · 🐦 [Twitter](https://x.com/synergix_lol) · 💰 [$SYNERGIX on BNB](https://four.meme/token/0xbe5df4a40ac939ef641430e86a2dce94d071e0f6)

---

## Architecture

```
synergix-web/
├── api/
│   ├── mcp.js          # MCP server (Model Context Protocol 2025-06-18)
│   ├── a2a.js          # A2A server (Agent2Agent Protocol, JSON-RPC 2.0)
│   └── _lib/
│       └── irys.js     # Irys client — seals the immortal memory onto Arweave
├── well-known/
│   └── agent.json      # A2A agent discovery card
├── index.html          # Landing page
├── vercel.json         # Vercel serverless config
└── package.json        # Node.js ES module declaration
```

## Endpoints

| Endpoint | Protocol | Description |
|---|---|---|
| `GET /api/mcp` | MCP 2025-06-18 | Tool manifest |
| `POST /api/mcp` | MCP 2025-06-18 | Tool execution |
| `GET /api/a2a` | A2A / JSON-RPC 2.0 | Agent card |
| `POST /api/a2a` | A2A / JSON-RPC 2.0 | Task execution |
| `GET /.well-known/agent.json` | A2A discovery | Agent registration |

## MCP Tools

| Tool | Description |
|---|---|
| `synergix_ask` | Query the collective brain via RAG + local AI (es / en / zh) |
| `synergix_ranks` | Full 6-tier rank table with multipliers and daily limits |
| `synergix_token` | $SYNERGIX contract info and tax distribution |
| `synergix_bucket` | Irys/Arweave sealed-memory structure and live stats |
| `synergix_stats` | Global network statistics and RAG engine health |
| `synergix_top` | Weekly top contributors leaderboard |

## AI Engine & Immortal Memory

Synergix runs on a **self-hosted local AI model** — no third-party AI APIs (no Groq, no OpenAI). Every response from `synergix_ask` is built in two modes:

- **Mode A** — 80% on-chain community knowledge (sealed on Irys/Arweave) + 20% local-model reasoning
- **Mode B** — 100% local model (fallback when no on-chain data matches the query)

**Irys is the sealer of Synergix's immortal memory:** every accepted contribution, fused brain version and database snapshot is sealed onto Arweave through Irys — permanent, immutable and impossible to erase. If the server dies, the entire state is restored from Irys on the next boot. Federation refresh: every 8 minutes.

## Rank System

| Rank | Points | Multiplier | Daily Limit |
|---|---|---|---|
| 🌱 Iniciado | 0 | 1.0× | 5 |
| 📈 Activo | 100 | 1.1× | 12 |
| 🧬 Sincronizado | 500 | 1.5× | 25 |
| 🏗️ Arquitecto | 1 500 | 2.5× | 40 |
| 🧠 Mente Colmena | 5 000 | 3.0× | 60 |
| 🔮 Oráculo | 15 000 | 5.0× | ∞ |

## Token

**$SYNERGIX** — BNB Chain  
Contract: `0xbe5df4a40ac939ef641430e86a2dce94d071e0f6`  
Tax: 1% buy / 1% sell — distributed as:

| Destination | % |
|---|---|
| Irys/Arweave storage | 40% |
| Buybacks & LP | 30% |
| Operations | 15% |
| Development | 10% |
| Rewards | 5% |

## Deploy

The project runs on Vercel as two serverless functions (`maxDuration: 30s`). No build step required — Vercel serves `index.html` as a static site and auto-deploys the `api/` handlers.

### Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Required | Description |
|---|---|---|
| `IRYS_PRIVATE_KEY` | Yes | BNB-funded wallet private key — Irys uses it to **seal** memory onto Arweave |
| `IRYS_GATEWAY` | No | Override Irys gateway (default: `https://gateway.irys.xyz`) |
| `MCP_SECRET` | No | Bearer token to restrict MCP access |

> Synergix's AI runs on a **self-hosted local model**, so no external AI API key (Groq/OpenAI) is required.

### Local development

```bash
npm install -g vercel
vercel dev
```

Functions are available at `http://localhost:3000/api/mcp` and `http://localhost:3000/api/a2a`.
