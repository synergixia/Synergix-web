/**
 * Synergix MCP Server — api/mcp.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Servidor MCP (Model Context Protocol) spec 2025-06-18
 * Desplegado en Vercel como serverless function.
 * Endpoint: https://www.synergix.lol/api/mcp
 *
 * TOOLS EXPUESTAS:
 *   1. synergix_ask        — Consulta al cerebro colectivo via RAG + Groq
 *   2. synergix_ranks      — Tabla de rangos oficial y sus multiplicadores
 *   3. synergix_token      — Info del token $SYNERGIX en BNB Chain
 *   4. synergix_bucket     — Estado del almacenamiento permanente en Irys
 *   5. synergix_stats      — Estadísticas globales del sistema
 *   6. synergix_top        — Top contributors de la semana
 *
 * VARIABLES DE ENTORNO (Vercel → Settings → Environment Variables):
 *   GROQ_API_KEY           — API key de Groq (obligatoria para synergix_ask)
 *   IRYS_GATEWAY         — SP de Irys (opcional, para datos live)
 *   IRYS_NAMESPACE              — Nombre del bucket (default: synergix-v2)
 *   MCP_SECRET             — Token de autorización opcional (recomendado)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── CONSTANTES DE SYNERGIX ────────────────────────────────────────────────────
const SYNERGIX = {
  name:        "Synergix",
  version:     "2.0.0",
  description: "The world's first AI on Irys — Decentralized collective intelligence",
  token: {
    symbol:   "$SYNERGIX",
    contract: "0x6485907278c389e70c572f441ce7052da58effff",
    network:  "BNB Chain",
    launch:   "https://four.meme/token/0x6485907278c389e70c572f441ce7052da58effff",
    tax_buy:  "1%",
    tax_sell: "1%",
    tax_distribution: {
      irys_storage: "40%",
      buybacks_lp:        "30%",
      operations:         "15%",
      development:        "10%",
      rewards:            "5%"
    }
  },
  links: {
    web:      "https://www.synergix.lol",
    telegram: "https://t.me/synergix_ai_bot",
    twitter:  "https://x.com/Synergix_AI",
    four_meme:"https://four.meme/token/0x6485907278c389e70c572f441ce7052da58effff"
  },
  bucket: {
    name:     "synergix-v2",
    network:  "Irys Network",
    chain_id: 1017,
    sp:       "https://gateway.irys.xyz",
    paths: {
      brain:    "SYNERGIXAI/Synergix_ia_*.txt",
      contribs: "aportes/YYYY-MM/{uid}_{ts}.txt",
      users:    "users/{uid}",
      db:       "data/synergix_db_*.json",
      logs:     "logs/YYYY-MM-DD_events.log",
      backups:  "backups/snapshot_*.bak"
    }
  },
  ranks: [
    { rank: "🌱 Iniciado",       min_pts: 0,     multiplier: 1.0, daily_limit: 5,   description: "Nuevo miembro de la colmena" },
    { rank: "📈 Activo",         min_pts: 100,   multiplier: 1.1, daily_limit: 12,  description: "Contribuidor regular" },
    { rank: "🧬 Sincronizado",   min_pts: 500,   multiplier: 1.5, daily_limit: 25,  description: "Mente alineada con la colmena" },
    { rank: "🏗️ Arquitecto",     min_pts: 1500,  multiplier: 2.5, daily_limit: 40,  description: "Constructor del conocimiento colectivo" },
    { rank: "🧠 Mente Colmena",  min_pts: 5000,  multiplier: 3.0, daily_limit: 60,  description: "Validador de la sabiduría colectiva" },
    { rank: "🔮 Oráculo",        min_pts: 15000, multiplier: 5.0, daily_limit: null, description: "Entidad suprema de conocimiento — sin límite diario" }
  ],
  rag: {
    mode_a: "80% datos Irys + 20% Groq (cuando hay datos on-chain)",
    mode_b: "100% Groq conocimiento general (sin datos on-chain aún)",
    scoring: "score = keyword_match × quality × fusion_weight × impact_boost × lang_boost × recency",
    federation_interval: "cada 8 minutos",
    languages: ["es", "en", "zh-hans", "zh-hant"]
  }
};

const GROQ_MODEL   = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// ── MCP MANIFEST ──────────────────────────────────────────────────────────────
const MCP_MANIFEST = {
  schema_version: "2025-06-18",
  name:        SYNERGIX.name,
  description: SYNERGIX.description,
  version:     SYNERGIX.version,
  tools: [
    {
      name:        "synergix_ask",
      description: "Ask Synergix a question using its RAG engine backed by Irys collective knowledge. Returns an AI-generated answer grounded in community contributions stored on-chain. Supports es/en/zh.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type:        "string",
            description: "The question or topic to ask Synergix about",
            maxLength:   500
          },
          lang: {
            type:        "string",
            description: "Response language: 'es' (Spanish), 'en' (English), 'zh' (Chinese). Default: 'es'",
            enum:        ["es", "en", "zh"],
            default:     "es"
          },
          context: {
            type:        "string",
            description: "Optional additional context to narrow the query",
            maxLength:   200
          }
        },
        required: ["query"]
      }
    },
    {
      name:        "synergix_ranks",
      description: "Get the full Synergix rank table showing all 6 tiers, their point thresholds, multipliers, and daily contribution limits. Essential for understanding the on-chain reputation system.",
      inputSchema: {
        type:       "object",
        properties: {
          lang: {
            type:    "string",
            description: "Response language",
            enum:    ["es", "en", "zh"],
            default: "en"
          }
        }
      }
    },
    {
      name:        "synergix_token",
      description: "Get $SYNERGIX token information: contract address, network, tax structure, and how 1% buy/sell tax funds Irys storage and operations.",
      inputSchema: {
        type:       "object",
        properties: {
          include_distribution: {
            type:        "boolean",
            description: "Include detailed tax distribution breakdown",
            default:     true
          }
        }
      }
    },
    {
      name:        "synergix_bucket",
      description: "Get information about the Synergix Irys permanent storage — the on-chain storage that powers the AI. Shows bucket structure, paths, and live stats if available.",
      inputSchema: {
        type:       "object",
        properties: {
          include_live: {
            type:        "boolean",
            description: "Attempt to fetch live stats from Irys gateway (may be slow)",
            default:     false
          }
        }
      }
    },
    {
      name:        "synergix_stats",
      description: "Get global Synergix network statistics: total users, contributions, active rank distribution, federation loop status, and RAG engine health.",
      inputSchema: {
        type:       "object",
        properties: {
          lang: {
            type:    "string",
            enum:    ["es", "en", "zh"],
            default: "en"
          }
        }
      }
    },
    {
      name:        "synergix_top",
      description: "Get the top contributors leaderboard from Synergix. Shows top users by points with their rank, contributions count, and impact score.",
      inputSchema: {
        type:       "object",
        properties: {
          limit: {
            type:        "integer",
            description: "Number of top users to return (1-20)",
            minimum:     1,
            maximum:     20,
            default:     10
          }
        }
      }
    }
  ]
};

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — permite que cualquier agente AI llame este endpoint
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-MCP-Version");
  res.setHeader("X-MCP-Server",   "Synergix/2.0.0");
  res.setHeader("X-MCP-Protocol", "2025-06-18");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Autorización opcional
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const auth = req.headers.authorization || "";
    if (!auth.includes(secret)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // GET → devolver el manifest (discovery)
  if (req.method === "GET") {
    return res.status(200).json(MCP_MANIFEST);
  }

  // POST → ejecutar una tool
  if (req.method === "POST") {
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const { tool, parameters = {}, id } = body;

    if (!tool) {
      // Sin tool → devolver manifest también (compatibilidad)
      return res.status(200).json(MCP_MANIFEST);
    }

    try {
      const result = await executeTool(tool, parameters);
      return res.status(200).json({
        id:      id || crypto.randomUUID(),
        tool,
        result,
        synergix_version: SYNERGIX.version,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error(`[MCP] Error en tool '${tool}':`, err);
      return res.status(500).json({
        error:   err.message || "Internal error",
        tool,
        id:      id || null
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ── DISPATCHER ────────────────────────────────────────────────────────────────
async function executeTool(tool, params) {
  switch (tool) {
    case "synergix_ask":    return await toolAsk(params);
    case "synergix_ranks":  return toolRanks(params);
    case "synergix_token":  return toolToken(params);
    case "synergix_bucket": return await toolBucket(params);
    case "synergix_stats":  return await toolStats(params);
    case "synergix_top":    return await toolTop(params);
    default:
      throw new Error(`Tool '${tool}' not found. Available tools: ${MCP_MANIFEST.tools.map(t=>t.name).join(", ")}`);
  }
}

// ── TOOL: synergix_ask ────────────────────────────────────────────────────────
async function toolAsk({ query, lang = "es", context = "" }) {
  if (!query || query.trim().length < 2) {
    throw new Error("query must be at least 2 characters");
  }

  const groqKey = process.env.GROQ_API_KEY;

  const langNames = { es: "Spanish", en: "English", zh: "Chinese (Simplified)" };
  const langName  = langNames[lang] || "Spanish";

  // System prompt que refleja la arquitectura real de Synergix
  const systemPrompt = `You are Synergix, the world's first AI deployed on Irys — a decentralized collective intelligence system.

Your knowledge comes from community contributions stored permanently on Irys permanent storage (bucket: "synergix-v2"). You are NOT a general chatbot — you are a specialized AI that answers based on collective on-chain knowledge.

KEY FACTS ABOUT YOU:
- You run as a Telegram bot (@synergix_ai_bot) with a 6-tier reputation system
- Your RAG engine uses keyword scoring: score = keyword_match × quality × fusion_weight × impact_boost × lang_boost × recency
- Every 8 minutes, your federation loop syncs new knowledge to Irys
- Your token is $SYNERGIX (CA: 0x6485907278c389e70c572f441ce7052da58effff) on BNB Chain
- Tax distribution: 40% Irys storage, 30% buybacks/LP, 15% operations, 10% development, 5% rewards
- You support: Spanish, English, 简体中文, 繁體中文

RANK SYSTEM (6 tiers):
🌱 Iniciado (0 pts) → 📈 Activo (100) → 🧬 Sincronizado (500) → 🏗️ Arquitecto (1500) → 🧠 Mente Colmena (5000) → 🔮 Oráculo (15000+, ×5.0, unlimited daily)

RESPONSE RULES:
- Always respond in ${langName}
- Be concise and direct — you are an on-chain AI, not a general assistant
- Mention that knowledge comes from Irys when relevant
- If you don't have specific on-chain knowledge, say so and provide general guidance
- Always stay in character as Synergix${context ? `\n\nAdditional context: ${context}` : ""}`;

  const userMessage = query;

  if (!groqKey) {
    // Sin API key → respuesta estática con info de Synergix
    return {
      answer:  `[Synergix MCP — Demo Mode] Query received: "${query}". To enable live AI responses, set GROQ_API_KEY in Vercel environment variables. Synergix uses Groq (${GROQ_MODEL}) with Irys RAG.`,
      source:  "demo",
      lang,
      model:   GROQ_MODEL,
      note:    "Set GROQ_API_KEY environment variable to enable live responses"
    };
  }

  // Llamada real a Groq
  const response = await fetch(GROQ_API_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      max_tokens:  600,
      temperature: 0.7,
      messages: [
        { role: "system",  content: systemPrompt },
        { role: "user",    content: userMessage }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data   = await response.json();
  const answer = data.choices?.[0]?.message?.content || "No response generated";

  return {
    answer,
    source:  "groq+rag",
    lang,
    model:   GROQ_MODEL,
    usage:   data.usage || null,
    rag_info: {
      engine:    "keyword-scoring",
      storage:   "Irys permanent storage: synergix-v2",
      sync:      "every 8 minutes via federation_loop",
      rule:      "80% on-chain data + 20% Groq (when data available)"
    }
  };
}

// ── TOOL: synergix_ranks ─────────────────────────────────────────────────────
function toolRanks({ lang = "en" }) {
  const labels = {
    en: {
      title:        "Synergix Rank System — 6 Tiers of Collective Intelligence",
      rank:         "Rank",
      min_pts:      "Min Points",
      multiplier:   "Multiplier",
      daily_limit:  "Daily Limit",
      description:  "Description",
      unlimited:    "Unlimited",
      note:         "Multipliers apply to points earned per contribution. Higher ranks also gain validation powers (🧠 Mente Colmena can validate others' contributions). 🔮 Oracles have no daily limit and earn 5× points.",
      scoring:      SYNERGIX.rag.scoring
    },
    es: {
      title:        "Sistema de Rangos Synergix — 6 Niveles de Inteligencia Colectiva",
      rank:         "Rango",
      min_pts:      "Puntos mín.",
      multiplier:   "Multiplicador",
      daily_limit:  "Límite diario",
      description:  "Descripción",
      unlimited:    "Sin límite",
      note:         "Los multiplicadores aplican a los puntos por contribución. Los rangos altos obtienen poderes de validación (🧠 Mente Colmena puede validar aportes de otros). 🔮 Oráculo no tiene límite diario y gana ×5 puntos.",
      scoring:      SYNERGIX.rag.scoring
    },
    zh: {
      title:        "Synergix 等级系统 — 集体智慧的6个层级",
      rank:         "等级",
      min_pts:      "最低积分",
      multiplier:   "倍率",
      daily_limit:  "每日限额",
      description:  "描述",
      unlimited:    "无限制",
      note:         "倍率适用于每次贡献获得的积分。高等级用户拥有验证权限（🧠 蜂巢思维可以验证他人的贡献）。🔮 神谕无每日限额，积分×5。",
      scoring:      SYNERGIX.rag.scoring
    }
  };

  const l = labels[lang] || labels.en;

  return {
    title:  l.title,
    ranks:  SYNERGIX.ranks.map(r => ({
      [l.rank]:        r.rank,
      [l.min_pts]:     r.min_pts,
      [l.multiplier]:  `×${r.multiplier}`,
      [l.daily_limit]: r.daily_limit ? r.daily_limit : l.unlimited,
      [l.description]: r.description
    })),
    note:    l.note,
    scoring: l.scoring,
    total_tiers: SYNERGIX.ranks.length
  };
}

// ── TOOL: synergix_token ─────────────────────────────────────────────────────
function toolToken({ include_distribution = true }) {
  const result = {
    name:      "Synergix",
    symbol:    SYNERGIX.token.symbol,
    contract:  SYNERGIX.token.contract,
    network:   SYNERGIX.token.network,
    tax: {
      buy:  SYNERGIX.token.tax_buy,
      sell: SYNERGIX.token.tax_sell,
      note: "Tax is collected automatically on every trade and allocated to the treasury"
    },
    links: {
      launch:   SYNERGIX.token.launch,
      web:      SYNERGIX.links.web,
      telegram: SYNERGIX.links.telegram,
      twitter:  SYNERGIX.links.twitter
    },
    unique_value: "First token whose tax directly funds on-chain AI storage on Irys. Every trade contributes to immortal knowledge on blockchain.",
    verify_on_chain: `https://bscscan.com/token/${SYNERGIX.token.contract}`
  };

  if (include_distribution) {
    result.tax_distribution = {
      ...SYNERGIX.token.tax_distribution,
      total: "100% of 1% tax",
      note:  "buybacks_lp are executed manually by the team, not by a contract"
    };
  }

  return result;
}

// ── TOOL: synergix_bucket ────────────────────────────────────────────────────
async function toolBucket({ include_live = false }) {
  const staticInfo = {
    bucket_name:   SYNERGIX.bucket.name,
    network:       SYNERGIX.bucket.network,
    chain_id:      SYNERGIX.bucket.chain_id,
    sp_endpoint:   SYNERGIX.bucket.sp,
    irys_url:   `https://gateway.irys.xyz/${SYNERGIX.bucket.name}`,
    structure: {
      "SYNERGIXAI/": "Versioned AI brain files (JSON, never deleted) — the collective knowledge",
      "aportes/YYYY-MM/": "Community contributions by month — RAG source",
      "users/{uid}": "User profiles with tags (rank, points, lang)",
      "data/synergix_db_*.json": "Full DB snapshot, synced every 8 minutes",
      "logs/YYYY-MM-DD_events.log": "Audit trail, flushed at midnight UTC",
      "backups/snapshot_*.bak": "Weekly snapshots every Monday"
    },
    rag_integration: {
      mode_a:    SYNERGIX.rag.mode_a,
      mode_b:    SYNERGIX.rag.mode_b,
      sync_freq: SYNERGIX.rag.federation_interval,
      scoring:   SYNERGIX.rag.scoring
    },
    unique_fact: "This bucket IS the AI brain. When the server restarts, the entire AI state is restored from Irys — zero data loss, 100% decentralized persistence."
  };

  if (include_live) {
    try {
      const spEndpoint = process.env.IRYS_GATEWAY || SYNERGIX.bucket.sp;
      const bucketName = process.env.IRYS_NAMESPACE      || SYNERGIX.bucket.name;
      const url = `${spEndpoint}/view/${bucketName}/data/stats.json`;

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 4000); // 4s timeout

      const resp = await fetch(url, { signal: controller.signal });
      if (resp.ok) {
        const liveData = await resp.json();
        staticInfo.live_stats = {
          fetched_at: new Date().toISOString(),
          ...liveData
        };
      } else {
        staticInfo.live_stats = { error: `SP returned ${resp.status}`, note: "Live data unavailable" };
      }
    } catch (e) {
      staticInfo.live_stats = { error: e.message, note: "Live data unavailable — SP may be slow or stats.json not yet created" };
    }
  }

  return staticInfo;
}

// ── TOOL: synergix_stats ─────────────────────────────────────────────────────
async function toolStats({ lang = "en" }) {
  // Intentar obtener stats desde GF si están disponibles
  let liveStats = null;
  try {
    const spEndpoint = process.env.IRYS_GATEWAY || SYNERGIX.bucket.sp;
    const bucketName = process.env.IRYS_NAMESPACE      || SYNERGIX.bucket.name;
    const url = `${spEndpoint}/view/${bucketName}/data/global_stats.json`;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(url, { signal: controller.signal });
    if (resp.ok) liveStats = await resp.json();
  } catch {
    // Sin stats live — OK
  }

  const base = {
    system: {
      name:        SYNERGIX.name,
      version:     SYNERGIX.version,
      status:      "operational",
      network:     SYNERGIX.bucket.network,
      bucket:      SYNERGIX.bucket.name,
      telegram:    SYNERGIX.links.telegram,
      web:         SYNERGIX.links.web
    },
    rag_engine: {
      type:           "keyword-scoring (no vectors, ARM-compatible)",
      scoring_formula: SYNERGIX.rag.scoring,
      sync_interval:  SYNERGIX.rag.federation_interval,
      supported_langs: SYNERGIX.rag.languages,
      data_source:    "Irys permanent storage: synergix"
    },
    rank_system: {
      tiers:      SYNERGIX.ranks.length,
      top_rank:   SYNERGIX.ranks[SYNERGIX.ranks.length - 1].rank,
      max_mult:   `×${SYNERGIX.ranks[SYNERGIX.ranks.length - 1].multiplier}`,
      validation: "🧠 Mente Colmena+ can validate contributions from others"
    },
    token: {
      symbol:   SYNERGIX.token.symbol,
      contract: SYNERGIX.token.contract,
      network:  SYNERGIX.token.network
    }
  };

  if (liveStats) {
    base.live = {
      fetched_at:   new Date().toISOString(),
      total_users:  liveStats.total_users       || "N/A",
      total_contribs: liveStats.total_contribs  || "N/A",
      weekly_top:   liveStats.weekly_top        || "N/A",
      active_challenge: liveStats.challenge     || null
    };
  } else {
    base.live = {
      note: "Live stats not yet available. Deploy synergix_stats feature or create data/global_stats.json in bucket."
    };
  }

  return base;
}

// ── TOOL: synergix_top ───────────────────────────────────────────────────────
async function toolTop({ limit = 10 }) {
  limit = Math.min(Math.max(1, parseInt(limit) || 10), 20);

  // Intentar obtener leaderboard desde GF
  let liveTop = null;
  try {
    const spEndpoint = process.env.IRYS_GATEWAY || SYNERGIX.bucket.sp;
    const bucketName = process.env.IRYS_NAMESPACE      || SYNERGIX.bucket.name;
    const url = `${spEndpoint}/view/${bucketName}/data/leaderboard.json`;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);

    const resp = await fetch(url, { signal: controller.signal });
    if (resp.ok) liveTop = await resp.json();
  } catch {
    // Sin datos live
  }

  if (liveTop && Array.isArray(liveTop.top)) {
    return {
      source:    "irys_live",
      fetched_at: new Date().toISOString(),
      total_shown: Math.min(limit, liveTop.top.length),
      leaderboard: liveTop.top.slice(0, limit),
      period:    liveTop.period || "current_week",
      note:      "Live data from Irys permanent storage: synergix"
    };
  }

  return {
    source: "static",
    note:   "Live leaderboard not yet available. The Synergix bot tracks top contributors in its Irys DB. To expose live data, create data/leaderboard.json in the synergix bucket.",
    how_to_earn: {
      contribute:  "Send knowledge to @synergix_ai_bot on Telegram",
      get_points:  "Each contribution is evaluated by AI (0-10 quality score)",
      multipliers: "Higher rank = more points per contribution",
      weekly_prize:"Top 3 contributors each week win special recognition"
    },
    ranks_reference: SYNERGIX.ranks.map(r => ({
      rank: r.rank, min_pts: r.min_pts, multiplier: `×${r.multiplier}`
    })),
    telegram: SYNERGIX.links.telegram
  };
}
