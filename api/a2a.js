/**
 * Synergix A2A Server — api/a2a.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agent2Agent Protocol (A2A) — Google open standard, Linux Foundation
 * Spec: https://a2a-protocol.org/latest/specification/
 *
 * Endpoint: https://www.synergix.lol/api/a2a
 * Discovery: https://www.synergix.lol/.well-known/agent.json
 *
 * Implementa el protocolo JSON-RPC 2.0 sobre HTTPS con soporte para:
 *   - message/send    → enviar mensaje y recibir respuesta directa
 *   - tasks/get       → consultar estado de una tarea
 *   - tasks/cancel    → cancelar una tarea
 *
 * SKILLS DISPONIBLES (mapean a las mismas tools del MCP):
 *   synergix_ask, synergix_ranks, synergix_token, synergix_bucket, synergix_stats
 *
 * VARIABLES DE ENTORNO (Vercel):
 *   IRYS_PRIVATE_KEY  — obligatoria (fail-fast si ausente)
 *   GROQ_API_KEY      — obligatoria para synergix_ask
 *   MCP_SECRET        — token de auth opcional
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { validateConfig, queryByTags, fetchById } from "./_lib/irys.js";

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const SYNERGIX = {
  name:     "Synergix",
  version:  "2.0.0",
  token_ca: "0x6485907278c389e70c572f441ce7052da58effff",
  storage: {
    network:  "Arweave (via Irys)",
    token:    "BNB",
    gateway:  "https://gateway.irys.xyz",
    app_name: "Synergix"
  },
  links: {
    web:      "https://www.synergix.lol",
    telegram: "https://t.me/synergix_ai_bot",
    twitter:  "https://x.com/Synergix_AI"
  },
  ranks: [
    { rank: "🌱 Iniciado",      min_pts: 0,     mult: 1.0, daily: 5   },
    { rank: "📈 Activo",        min_pts: 100,   mult: 1.1, daily: 12  },
    { rank: "🧬 Sincronizado",  min_pts: 500,   mult: 1.5, daily: 25  },
    { rank: "🏗️ Arquitecto",    min_pts: 1500,  mult: 2.5, daily: 40  },
    { rank: "🧠 Mente Colmena", min_pts: 5000,  mult: 3.0, daily: 60  },
    { rank: "🔮 Oráculo",       min_pts: 15000, mult: 5.0, daily: null }
  ]
};

const GROQ_MODEL   = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Estado de tareas en memoria (stateless entre invocaciones serverless)
const taskStore = new Map();

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Fail-fast: IRYS_PRIVATE_KEY must be configured
  try {
    validateConfig();
  } catch (err) {
    console.error("[A2A] CRITICAL config error:", err.message);
    return res.status(500).json(jsonRpcError(null, -32603, err.message));
  }

  // Auth opcional
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (!auth.includes(secret)) {
      return res.status(401).json(jsonRpcError(null, -32001, "Unauthorized"));
    }
  }

  if (req.method === "GET") {
    return res.status(200).json({
      agent:    SYNERGIX.name,
      version:  SYNERGIX.version,
      protocol: "A2A",
      card:     "https://www.synergix.lol/.well-known/agent.json",
      endpoint: "https://www.synergix.lol/api/a2a",
      note:     "Send POST with JSON-RPC 2.0 payload"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json(jsonRpcError(null, -32700, "Method not allowed"));
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json(jsonRpcError(null, -32700, "Parse error"));
  }

  const { jsonrpc, method, params, id } = body;

  if (jsonrpc !== "2.0") {
    return res.status(400).json(jsonRpcError(id, -32600, "Invalid Request — jsonrpc must be '2.0'"));
  }

  try {
    switch (method) {
      case "message/send":
        return res.status(200).json(await handleMessageSend(id, params));

      case "tasks/get":
        return res.status(200).json(handleTasksGet(id, params));

      case "tasks/cancel":
        return res.status(200).json(handleTasksCancel(id, params));

      case "agent/authenticatedExtendedCard":
        return res.status(200).json(jsonRpcResult(id, await getExtendedCard()));

      default:
        return res.status(200).json(jsonRpcError(id, -32601, `Method '${method}' not found`));
    }
  } catch (err) {
    console.error("[A2A] Error:", err);
    return res.status(500).json(jsonRpcError(id, -32603, err.message || "Internal error"));
  }
}

// ── message/send ──────────────────────────────────────────────────────────────
async function handleMessageSend(rpcId, params) {
  if (!params || !params.message) {
    return jsonRpcError(rpcId, -32602, "Invalid params — 'message' is required");
  }

  const { message, configuration } = params;
  const taskId    = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const contextId = message.contextId || `ctx_${Date.now()}`;

  const textParts = (message.parts || []).filter(p => p.kind === "text" || p.type === "text");
  const inputText = textParts.map(p => p.text || p.content || "").join(" ").trim();

  if (!inputText) {
    return jsonRpcError(rpcId, -32602, "No text content found in message parts");
  }

  const skillId = (configuration?.skill) || detectSkill(inputText);
  const lang    = (configuration?.lang)  || detectLang(inputText);

  let artifactContent;
  try {
    artifactContent = await executeSkill(skillId, inputText, lang);
  } catch (err) {
    return jsonRpcError(rpcId, -32603, err.message);
  }

  const task = {
    id:        taskId,
    contextId,
    status: {
      state:     "completed",
      timestamp: new Date().toISOString(),
      message: {
        role:  "agent",
        parts: [
          {
            kind: "text",
            text: typeof artifactContent === "string"
                    ? artifactContent
                    : JSON.stringify(artifactContent, null, 2)
          }
        ]
      }
    },
    artifacts: [
      {
        artifactId: `artifact_${taskId}`,
        name:       `synergix_${skillId}_result`,
        parts: [
          {
            kind: "data",
            data: artifactContent
          }
        ]
      }
    ],
    metadata: {
      agent:    SYNERGIX.name,
      version:  SYNERGIX.version,
      skill:    skillId,
      lang,
      storage:  `${SYNERGIX.storage.network} — App-Name: ${SYNERGIX.storage.app_name}`,
      protocol: "A2A"
    }
  };

  taskStore.set(taskId, task);
  return jsonRpcResult(rpcId, task);
}

// ── tasks/get ─────────────────────────────────────────────────────────────────
function handleTasksGet(rpcId, params) {
  const taskId = params?.id;
  if (!taskId) {
    return jsonRpcError(rpcId, -32602, "Invalid params — 'id' is required");
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return jsonRpcError(rpcId, -32001, `Task '${taskId}' not found. Note: Synergix A2A is stateless — tasks complete synchronously in message/send.`);
  }

  return jsonRpcResult(rpcId, task);
}

// ── tasks/cancel ──────────────────────────────────────────────────────────────
function handleTasksCancel(rpcId, params) {
  const taskId = params?.id;
  if (!taskId) {
    return jsonRpcError(rpcId, -32602, "Invalid params — 'id' is required");
  }

  return jsonRpcResult(rpcId, {
    id:     taskId,
    status: { state: "canceled", timestamp: new Date().toISOString() },
    note:   "Synergix A2A tasks complete synchronously — nothing to cancel"
  });
}

// ── SKILL EXECUTION ───────────────────────────────────────────────────────────
async function executeSkill(skillId, inputText, lang) {
  switch (skillId) {
    case "synergix_ask":    return await skillAsk(inputText, lang);
    case "synergix_ranks":  return skillRanks(lang);
    case "synergix_token":  return skillToken();
    case "synergix_bucket": return await skillBucket();
    case "synergix_stats":  return await skillStats();
    default:
      return await skillAsk(inputText, lang);
  }
}

// ── SKILL: synergix_ask ───────────────────────────────────────────────────────
async function skillAsk(query, lang = "es") {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new Error("CRITICAL: GROQ_API_KEY not set. synergix_ask requires Groq API access.");
  }

  const langNames = { es: "Spanish", en: "English", zh: "Chinese (Simplified)" };
  const langName  = langNames[lang] || "Spanish";

  const systemPrompt = `You are Synergix, a decentralized collective intelligence AI accessed via the A2A protocol. Your knowledge is permanently stored on Arweave via Irys (BNB payments), indexed by tags: App-Name: Synergix, Type: aporte.

IDENTITY:
- Telegram bot: @synergix_ai_bot | Web: synergix.lol | Token: $SYNERGIX (BNB Chain)
- Contract: ${SYNERGIX.token_ca}
- RAG scoring: keyword_match × quality × fusion_weight × impact_boost × lang_boost × recency
- Federation sync: every 8 minutes to Irys/Arweave permanently
- Tax: 1% buy + 1% sell → 40% Irys storage, 30% buybacks/LP, 15% ops, 10% dev, 5% rewards

RANKS: 🌱 Iniciado(0) → 📈 Activo(100) → 🧬 Sincronizado(500) → 🏗️ Arquitecto(1500) → 🧠 Mente Colmena(5000) → 🔮 Oráculo(15000, ×5.0, unlimited)

Respond in ${langName}. Be concise and direct. You are communicating via A2A protocol with another AI agent.`;

  const response = await fetch(GROQ_API_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      max_tokens:  500,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: query }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API error: ${response.status}`);
  }

  const data   = await response.json();
  const answer = data.choices?.[0]?.message?.content || "No response";

  return {
    answer,
    source:   "groq+rag",
    lang,
    model:    GROQ_MODEL,
    storage:  `${SYNERGIX.storage.network} — App-Name: ${SYNERGIX.storage.app_name}`,
    protocol: "A2A"
  };
}

// ── SKILL: synergix_ranks ─────────────────────────────────────────────────────
function skillRanks(lang = "en") {
  return {
    title:    "Synergix On-Chain Rank System",
    protocol: "A2A",
    ranks:    SYNERGIX.ranks.map(r => ({
      rank:        r.rank,
      min_points:  r.min_pts,
      multiplier:  `×${r.mult}`,
      daily_limit: r.daily ?? "unlimited"
    })),
    scoring:    "score = keyword_match × quality(0-10) × fusion_weight × impact_boost × lang_boost × recency",
    validation: "🧠 Mente Colmena+ can validate contributions from other users",
    challenge:  "Weekly AI-generated challenge — top 3 earn special recognition",
    telegram:   SYNERGIX.links.telegram
  };
}

// ── SKILL: synergix_token ─────────────────────────────────────────────────────
function skillToken() {
  return {
    name:     "Synergix",
    symbol:   "$SYNERGIX",
    contract: SYNERGIX.token_ca,
    network:  "BNB Chain",
    protocol: "A2A",
    tax: {
      buy:  "1%",
      sell: "1%"
    },
    tax_distribution: {
      irys_storage: "40%",
      buybacks_lp:  "30% (manual by team)",
      operations:   "15%",
      development:  "10%",
      rewards:      "5%"
    },
    unique_value: "First token whose tax directly funds permanent AI storage on Arweave via Irys (BNB payments)",
    links: {
      launch:   `https://four.meme/token/${SYNERGIX.token_ca}`,
      bscscan:  `https://bscscan.com/token/${SYNERGIX.token_ca}`,
      web:      SYNERGIX.links.web,
      telegram: SYNERGIX.links.telegram,
      twitter:  SYNERGIX.links.twitter
    }
  };
}

// ── SKILL: synergix_bucket ────────────────────────────────────────────────────
async function skillBucket() {
  let liveStats = null;
  try {
    const nodes = await queryByTags([{ name: "Type", values: ["global-stats"] }], 1);
    if (nodes.length > 0) {
      liveStats = await fetchById(nodes[0].id);
    }
  } catch {
    // No live data
  }

  const result = {
    storage_network: SYNERGIX.storage.network,
    payment_token:   SYNERGIX.storage.token,
    gateway:         SYNERGIX.storage.gateway,
    protocol:        "A2A",
    tag_structure: {
      "Type: brain":        "Versioned AI brain (JSON, immutable) — collective knowledge, never deleted",
      "Type: aporte":       "Community contributions (+ Year-Month, User-Id) — RAG source",
      "Type: user":         "User profiles with rank/points (+ User-Id)",
      "Type: db-snapshot":  "Full DB snapshot, uploaded every 8 min",
      "Type: log":          "Audit trail (+ Date), flushed at midnight UTC",
      "Type: backup":       "Weekly snapshots",
      "Type: global-stats": "Global network statistics",
      "Type: leaderboard":  "Weekly contributor leaderboard"
    },
    rag: {
      mode_a:  "80% Irys/Arweave data + 20% Groq (when on-chain data available)",
      mode_b:  "100% Groq (no data yet)",
      sync:    "every 8 minutes via federation_loop",
      scoring: "keyword × quality × fusion_weight × impact × lang_boost × recency"
    },
    unique_fact: "All data is permanently stored on Arweave via Irys (BNB). Immutable, censorship-resistant — the AI brain persists forever on the permaweb."
  };

  if (liveStats) {
    result.live_stats = {
      fetched_at: new Date().toISOString(),
      ...liveStats
    };
  }

  return result;
}

// ── SKILL: synergix_stats ─────────────────────────────────────────────────────
async function skillStats() {
  let liveStats = null;
  try {
    const nodes = await queryByTags([{ name: "Type", values: ["global-stats"] }], 1);
    if (nodes.length > 0) {
      liveStats = await fetchById(nodes[0].id);
    }
  } catch {
    // No live data
  }

  const result = {
    agent:               SYNERGIX.name,
    version:             SYNERGIX.version,
    status:              "operational",
    protocol:            "A2A",
    protocols_supported: ["A2A", "MCP"],
    storage: {
      type:     SYNERGIX.storage.network,
      token:    SYNERGIX.storage.token,
      gateway:  SYNERGIX.storage.gateway,
      app_name: SYNERGIX.storage.app_name
    },
    rag_engine: {
      type:      "keyword-scoring (ARM-compatible, no vectors)",
      sync:      "every 8 minutes",
      languages: ["es", "en", "zh-hans", "zh-hant"]
    },
    rank_system: {
      tiers:    6,
      max_rank: "🔮 Oráculo",
      max_mult: "×5.0"
    },
    token: {
      symbol:   "$SYNERGIX",
      network:  "BNB Chain",
      contract: SYNERGIX.token_ca
    },
    links: SYNERGIX.links
  };

  if (liveStats) {
    result.live = {
      fetched_at:     new Date().toISOString(),
      total_users:    liveStats.total_users    || "N/A",
      total_contribs: liveStats.total_contribs || "N/A",
      weekly_top:     liveStats.weekly_top     || "N/A"
    };
  }

  return result;
}

// ── SKILL DETECTION ───────────────────────────────────────────────────────────
function detectSkill(text) {
  if (/rank|tier|level|rang|nivel|puntos|points|mult/i.test(text))                  return "synergix_ranks";
  if (/token|contract|tax|buy|sell|price|precio|0x|bnb|bsc/i.test(text))            return "synergix_token";
  if (/irys|arweave|storage|almacenamiento|brain|cerebro|permaweb/i.test(text))     return "synergix_bucket";
  if (/stats|statistics|status|estado|network|health|usuarios|users/i.test(text))   return "synergix_stats";
  return "synergix_ask";
}

function detectLang(text) {
  if (/[一-鿿]/.test(text)) return "zh";
  if (/\b(que|como|para|con|una|esto|este|qué|cómo)\b/i.test(text)) return "es";
  return "en";
}

// ── HELPERS JSON-RPC 2.0 ──────────────────────────────────────────────────────
function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id, code, message, data = null) {
  const error = { code, message };
  if (data) error.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error };
}

async function getExtendedCard() {
  return {
    name:         SYNERGIX.name,
    version:      SYNERGIX.version,
    endpoint:     "https://www.synergix.lol/api/a2a",
    card:         "https://www.synergix.lol/.well-known/agent.json",
    extended:     true,
    skills:       ["synergix_ask", "synergix_ranks", "synergix_token", "synergix_bucket", "synergix_stats"],
    protocols:    ["A2A", "MCP"],
    mcp_endpoint: "https://www.synergix.lol/api/mcp"
  };
}
