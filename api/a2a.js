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
 *   GROQ_API_KEY  — obligatorio para synergix_ask
 *   MCP_SECRET    — token de auth opcional
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const SYNERGIX = {
  name:     "Synergix",
  version:  "2.0.0",
  token_ca: "0x6485907278c389e70c572f441ce7052da58effff",
  bucket:   "synergix-v2",
  sp:       "https://greenfield-sp.bnbchain.org",
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

// Estado de tareas en memoria (serverless — stateless entre invocaciones)
// Para persistencia real se necesitaría Redis/KV, pero A2A funciona sin estado
// porque Vercel serverless completa cada tarea en la misma invocación.
const taskStore = new Map();

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Auth opcional
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (!auth.includes(secret)) {
      return res.status(401).json(jsonRpcError(null, -32001, "Unauthorized"));
    }
  }

  // GET → redirigir al agent card
  if (req.method === "GET") {
    return res.status(200).json({
      agent:     SYNERGIX.name,
      version:   SYNERGIX.version,
      protocol:  "A2A",
      card:      "https://www.synergix.lol/.well-known/agent.json",
      endpoint:  "https://www.synergix.lol/api/a2a",
      note:      "Send POST with JSON-RPC 2.0 payload"
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json(jsonRpcError(null, -32700, "Method not allowed"));
  }

  // Parsear body JSON-RPC
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

  // Dispatch por método A2A
  try {
    switch (method) {
      case "message/send":
        return res.status(200).json(await handleMessageSend(id, params));

      case "tasks/get":
        return res.status(200).json(handleTasksGet(id, params));

      case "tasks/cancel":
        return res.status(200).json(handleTasksCancel(id, params));

      case "agent/authenticatedExtendedCard":
        // Devolver el mismo agent card (sin datos extra en este caso)
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
  const taskId   = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const contextId = message.contextId || `ctx_${Date.now()}`;

  // Extraer texto del mensaje (A2A usa Parts)
  const textParts = (message.parts || []).filter(p => p.kind === "text" || p.type === "text");
  const inputText = textParts.map(p => p.text || p.content || "").join(" ").trim();

  if (!inputText) {
    return jsonRpcError(rpcId, -32602, "No text content found in message parts");
  }

  // Detectar skill solicitada (por metadata o autodetect)
  const skillId = (configuration?.skill) || detectSkill(inputText);
  const lang    = (configuration?.lang) || detectLang(inputText);

  // Ejecutar la skill
  let artifactContent;
  try {
    artifactContent = await executeSkill(skillId, inputText, lang);
  } catch (err) {
    artifactContent = { error: err.message, skill: skillId };
  }

  // Respuesta A2A — Task completada directamente (no hay streaming)
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
      agent:   SYNERGIX.name,
      version: SYNERGIX.version,
      skill:   skillId,
      lang,
      storage: `BNB Greenfield bucket: ${SYNERGIX.bucket}`,
      protocol:"A2A"
    }
  };

  // Guardar en store (para tasks/get — dentro de la misma invocación)
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
    // En serverless stateless, la tarea ya no existe entre invocaciones
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

  // Synergix completa tareas sincrónicamente, no hay tareas en curso que cancelar
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
    case "synergix_bucket": return skillBucket();
    case "synergix_stats":  return skillStats();
    default:
      // Skill desconocida → usar ask como fallback
      return await skillAsk(inputText, lang);
  }
}

// ── SKILL: synergix_ask ───────────────────────────────────────────────────────
async function skillAsk(query, lang = "es") {
  const groqKey = process.env.GROQ_API_KEY;
  const langNames = { es: "Spanish", en: "English", zh: "Chinese (Simplified)" };
  const langName  = langNames[lang] || "Spanish";

  const systemPrompt = `You are Synergix, the world's first AI deployed on BNB Greenfield DCellar — a decentralized collective intelligence system accessed via the A2A protocol.

Your knowledge comes from community contributions stored permanently on BNB Greenfield blockchain (bucket: "synergix-v2"). You are a specialized agent that answers based on collective on-chain knowledge.

IDENTITY:
- Telegram bot: @synergix_ai_bot | Web: synergix.lol | Token: $SYNERGIX (BNB Chain)
- Contract: ${SYNERGIX.token_ca}
- RAG scoring: keyword_match × quality × fusion_weight × impact_boost × lang_boost × recency
- Federation sync: every 8 minutes to Greenfield
- Tax: 1% buy + 1% sell → 40% Greenfield storage, 30% buybacks/LP, 15% ops, 10% dev, 5% rewards

RANKS: 🌱 Iniciado(0) → 📈 Activo(100) → 🧬 Sincronizado(500) → 🏗️ Arquitecto(1500) → 🧠 Mente Colmena(5000) → 🔮 Oráculo(15000, ×5.0, unlimited)

Respond in ${langName}. Be concise and direct. You are communicating via A2A protocol with another AI agent.`;

  if (!groqKey) {
    return {
      answer: `[Synergix A2A — Demo Mode] Query: "${query}". Set GROQ_API_KEY in Vercel to enable live RAG responses.`,
      source: "demo",
      lang,
      protocol: "A2A"
    };
  }

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
    storage:  `BNB Greenfield bucket: ${SYNERGIX.bucket}`,
    protocol: "A2A"
  };
}

// ── SKILL: synergix_ranks ─────────────────────────────────────────────────────
function skillRanks(lang = "en") {
  return {
    title:   "Synergix On-Chain Rank System",
    protocol:"A2A",
    ranks:   SYNERGIX.ranks.map(r => ({
      rank:        r.rank,
      min_points:  r.min_pts,
      multiplier:  `×${r.mult}`,
      daily_limit: r.daily ?? "unlimited"
    })),
    scoring: "score = keyword_match × quality(0-10) × fusion_weight × impact_boost × lang_boost × recency",
    validation: "🧠 Mente Colmena+ can validate contributions from other users",
    challenge:  "Weekly AI-generated challenge — top 3 earn special recognition",
    telegram:   SYNERGIX.links.telegram
  };
}

// ── SKILL: synergix_token ─────────────────────────────────────────────────────
function skillToken() {
  return {
    name:        "Synergix",
    symbol:      "$SYNERGIX",
    contract:    SYNERGIX.token_ca,
    network:     "BNB Chain",
    protocol:    "A2A",
    tax: {
      buy:  "1%",
      sell: "1%"
    },
    tax_distribution: {
      greenfield_storage: "40%",
      buybacks_lp:        "30% (manual by team)",
      operations:         "15%",
      development:        "10%",
      rewards:            "5%"
    },
    unique_value: "First token whose tax directly funds on-chain AI storage on BNB Greenfield DCellar",
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
function skillBucket() {
  return {
    bucket_name: SYNERGIX.bucket,
    network:     "BNB Greenfield Mainnet",
    chain_id:    1017,
    sp_endpoint: SYNERGIX.sp,
    protocol:    "A2A",
    structure: {
      "SYNERGIXAI/":              "Versioned AI brain (JSON) — collective knowledge, never deleted",
      "aportes/YYYY-MM/":         "Community contributions by month — RAG source",
      "users/{uid}":              "User profiles with rank/points tags",
      "data/synergix_db_*.json":  "Full DB snapshot, synced every 8 min",
      "logs/YYYY-MM-DD.log":      "Audit trail, flushed at midnight UTC",
      "backups/snapshot_*.bak":   "Weekly snapshots"
    },
    rag: {
      mode_a:   "80% Greenfield data + 20% Groq (when on-chain data available)",
      mode_b:   "100% Groq (no data yet)",
      sync:     "every 8 minutes via federation_loop",
      scoring:  "keyword × quality × fusion_weight × impact × lang_boost × recency"
    },
    unique_fact: "The bucket IS the AI brain. Full state restored from Greenfield on server restart — zero data loss, 100% decentralized."
  };
}

// ── SKILL: synergix_stats ─────────────────────────────────────────────────────
function skillStats() {
  return {
    agent:    SYNERGIX.name,
    version:  SYNERGIX.version,
    status:   "operational",
    protocol: "A2A",
    protocols_supported: ["A2A", "MCP"],
    storage: {
      type:    "BNB Greenfield DCellar",
      bucket:  SYNERGIX.bucket,
      network: "Mainnet",
      chain_id: 1017
    },
    rag_engine: {
      type:       "keyword-scoring (ARM-compatible, no vectors)",
      sync:       "every 8 minutes",
      languages:  ["es", "en", "zh-hans", "zh-hant"]
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
}

// ── SKILL DETECTION ───────────────────────────────────────────────────────────
function detectSkill(text) {
  const t = text.toLowerCase();
  if (/rank|tier|level|rang|nivel|puntos|points|mult/i.test(t)) return "synergix_ranks";
  if (/token|contract|tax|buy|sell|price|precio|0x|bnb|bsc/i.test(t)) return "synergix_token";
  if (/bucket|greenfield|dcellar|storage|almacenamiento|brain|cerebro/i.test(t)) return "synergix_bucket";
  if (/stats|statistics|status|estado|network|health|usuarios|users/i.test(t)) return "synergix_stats";
  return "synergix_ask"; // default
}

function detectLang(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
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
  // Mismo agent card + skills extendidas con autenticación
  return {
    name:     SYNERGIX.name,
    version:  SYNERGIX.version,
    endpoint: "https://www.synergix.lol/api/a2a",
    card:     "https://www.synergix.lol/.well-known/agent.json",
    extended: true,
    skills:   ["synergix_ask", "synergix_ranks", "synergix_token", "synergix_bucket", "synergix_stats"],
    protocols:["A2A", "MCP"],
    mcp_endpoint: "https://www.synergix.lol/api/mcp"
  };
}
