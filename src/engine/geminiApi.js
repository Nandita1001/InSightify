/**
 * geminiApi.js — Gemini API Integration + Local Fallback
 *
 * Functions:
 *   parseQuery(question, registryMetadata, conversationContext) → analysis plan JSON
 *   generateNarrative(analysisResults, question, metricDefinitions) → narrative string
 *   fallbackParseQuery(question, registryMetadata) → analysis plan (no API needed)
 *   fallbackNarrative(analysisResults, question) → template-based narrative
 *   isApiAvailable() → boolean
 *
 * Rules:
 *  - Never send raw data rows to Gemini — only column names + aggregated numbers.
 *  - All API calls wrapped in try/catch — always fall back gracefully.
 *  - Simple rate limiter: skip API and use fallback after 14 calls / 60 s.
 *  - Strip markdown fences from Gemini responses before JSON.parse.
 */
import { formatNumber, formatPercent } from "./analysisOps.js";

/* ═══════════════════════════════════════════════════════════
   §0  CONSTANTS & RATE LIMITER
═══════════════════════════════════════════════════════════ */



const RATE_LIMIT = 14; // calls per window
const RATE_WINDOW_MS = 60_000; // 60 seconds

/** Timestamps (ms) of recent API calls */
const _callLog = [];

/** Returns true if we can make another API call right now. Also records the call. */
function _reserveApiCall() {
  const now = Date.now();
  // Drop entries older than the window
  while (_callLog.length > 0 && now - _callLog[0] > RATE_WINDOW_MS) {
    _callLog.shift();
  }
  if (_callLog.length >= RATE_LIMIT) return false;
  _callLog.push(now);
  return true;
}

/* ═══════════════════════════════════════════════════════════
   §1  UTILITY HELPERS
═══════════════════════════════════════════════════════════ */

/**
 * Extract JSON from an LLM response that may contain markdown fences, prose, or both.
 * Tries:
 *  1. Strip ```json...``` fences
 *  2. Find first { … } or [ … ] block via greedy regex
 *  3. Return cleaned text as-is (caller will try JSON.parse)
 */
function stripMarkdownFences(text) {
  // 1. Strip triple-backtick fences
  let cleaned = text
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // 2. If result still doesn't start with { or [, try to extract the JSON object
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const match = cleaned.match(/(\{[\s\S]*\})/);
    if (match) cleaned = match[1];
  }

  return cleaned;
}

/**
 * Low-level Groq POST — uses proper system/user message roles.
 * @param {string} prompt     — user prompt text
 * @param {string} [system]   — optional system prompt (sent as role:"system")
 */
async function _callGemini(prompt, system = null) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    // On 429 rate-limit, throw with specific message so callers can handle
    throw new Error(`Groq API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) throw new Error("Groq returned empty response.");
  return text;
}


/** Validate and coerce an analysis plan object so consumers never crash. */
function _normalizeAnalysisList(rawAnalysis, rawIntent, question = "") {
  const ANALYSES = [
    "max", "min", "trend", "comparison", "breakdown",
    "summary", "anomaly", "correlation", "computed_metric",
    "text_search", "sentiment",
  ];

  const fromRaw = []
    .concat(rawAnalysis ?? [])
    .concat(rawIntent ? [rawIntent] : [])
    .map((v) => String(v).toLowerCase().trim())
    .flatMap((v) => {
      if (!v) return [];
      if (["highest", "top", "best", "most", "maximum", "max"].includes(v)) return ["max"];
      if (["lowest", "bottom", "worst", "least", "minimum", "min"].includes(v)) return ["min"];
      if (v === "ranking") return /\b(lowest|bottom|worst|least|min|minimum)\b/i.test(question) ? ["min"] : ["max"];
      return [v];
    })
    .filter((v) => ANALYSES.includes(v));

  return [...new Set(fromRaw)];
}

function _normalizePlan(raw, question = "") {
  const INTENTS = [
    "breakdown", "comparison", "trend", "summary", "ranking", "anomaly",
    "correlation", "computed_metric", "text_search", "sentiment", "aggregate",
  ];
  const dataset = typeof raw?.dataset === "string" && raw.dataset
    ? raw.dataset
    : (Array.isArray(raw?.datasets) ? raw.datasets[0] : "");
  const metrics = Array.isArray(raw?.metrics)
    ? raw.metrics.filter((v) => typeof v === "string" && v)
    : (Array.isArray(raw?.columns) ? raw.columns.filter((v) => typeof v === "string" && v) : []);
  const dimensions = Array.isArray(raw?.dimensions)
    ? raw.dimensions.filter((v) => typeof v === "string" && v)
    : [];
  const analysis = _normalizeAnalysisList(raw?.analysis, raw?.intent, question);
  const intent = INTENTS.includes(raw?.intent) ? raw.intent : (
    analysis.includes("sentiment") ? "sentiment" :
    analysis.includes("comparison") ? "comparison" :
    analysis.includes("trend") ? "trend" :
    analysis.includes("max") || analysis.includes("min") ? "ranking" :
    "summary"
  );

  return {
    intent,
    dataset,
    metrics,
    dimensions,
    analysis: analysis.length > 0 ? analysis : [intent === "ranking" ? "max" : intent],
    datasets: dataset ? [dataset] : [],
    columns: [...new Set([...metrics, ...dimensions])],
    operations: Array.isArray(raw?.operations) ? raw.operations : [],
    chartType: typeof raw?.chartType === "string" ? raw.chartType : "table",
    title: typeof raw?.title === "string" ? raw.title : "Analysis",
  };
}

/** Format registry metadata into a readable text block for prompts. */
function _buildRegistryText(registryMetadata) {
  return (registryMetadata ?? [])
    .map((ds) => {
      const cols = (ds.columns ?? [])
        .map((c) => `    - ${c.name} (${c.type})${c.description ? ": " + c.description : ""}`)
        .join("\n");
      return `Dataset: "${ds.name}"\nDescription: ${ds.description}\nColumns:\n${cols}`;
    })
    .join("\n\n");
}

/** Format conversation context for the prompt. */
function _buildContextText(conversationContext) {
  if (!conversationContext || conversationContext.length === 0)
    return "(no prior conversation)";
  return conversationContext
    .slice(-3)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content).slice(0, 200)}`)
    .join("\n");
}

function _isSentimentQuery(question = "") {
  return /\bhappy\b|\bhappiness\b|\bsatisfied?\b|\bsatisfaction\b|\bfeel(?:ing|ings)?\b|\bfeedback\b|\bcomplaints?\b|\breviews?\b|\bunhappy\b|\bdissatisfied\b|\bsentiment\b/i.test(question);
}

function _findFeedbackDataset(registryMetadata = []) {
  return registryMetadata.find((ds) =>
    ds?.id === "customer_feedback" ||
    ds?.name?.toLowerCase().includes("customer feedback") ||
    ds?.name?.toLowerCase().includes("feedback")
  ) ?? null;
}

function _coerceSentimentPlan(plan, question, registryMetadata) {
  const feedbackDataset = _findFeedbackDataset(registryMetadata);
  const datasetColumns = feedbackDataset?.columns ?? [];
  const textCol = datasetColumns.find((c) => c.type === "text")?.name ?? "text";
  const groupCol =
    datasetColumns.find((c) => c.name.toLowerCase() === "region")?.name ??
    datasetColumns.find((c) => c.type === "categorical")?.name ??
    datasetColumns.find((c) => c.type === "date")?.name ??
    null;
  const sentimentTriggered =
    _isSentimentQuery(question) ||
    plan?.intent === "sentiment" ||
    (plan?.datasets ?? []).some((ds) => String(ds).toLowerCase().includes("feedback"));

  if (!sentimentTriggered) return plan;

  const safeColumns = [textCol, groupCol].filter(Boolean);

  return {
    ...plan,
    intent: "sentiment",
    dataset: feedbackDataset?.id ?? plan?.dataset ?? "",
    metrics: [textCol],
    dimensions: groupCol ? [groupCol] : [],
    analysis: ["sentiment"],
    datasets: feedbackDataset ? [feedbackDataset.id] : (plan?.datasets ?? []),
    columns: safeColumns,
    operations: [],
    chartType: "pie",
    title: typeof plan?.title === "string" && plan.title.trim()
      ? plan.title
      : "Sentiment Analysis",
  };
}

/* ═══════════════════════════════════════════════════════════
   §2  PUBLIC UTILITY
═══════════════════════════════════════════════════════════ */

/**
 * Returns true if the Gemini API key is configured.
 * Use to show "AI-powered" vs "Local analysis" indicator in the UI.
 */
export function isApiAvailable() {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  return typeof key === "string" && key.trim().length > 10;
}

/* ═══════════════════════════════════════════════════════════
   §3  parseQuery
═══════════════════════════════════════════════════════════ */

const PARSE_QUERY_SYSTEM = `You are a data analysis query planner. Given a user's question and available datasets, return ONLY valid JSON with this exact structure:
{"intent":"summary|comparison|trend|ranking|breakdown|anomaly|correlation|computed_metric|text_search|sentiment","dataset":"dataset_id_or_name","metrics":["metric1"],"dimensions":["dimension1"],"analysis":["max|min|trend|comparison|breakdown|summary|anomaly|correlation|computed_metric|text_search|sentiment"]}

Rules:
- "analysis" can contain multiple values when the question asks for multiple conditions
- "max and min", "highest and lowest", "top and bottom" MUST return analysis:["max","min"]
- trend/change/over time → include "trend"
- compare/vs/versus → include "comparison"
- text search/find mention/keyword lookup → include "text_search"
- happiness, satisfaction, feelings, feedback, complaints, reviews → MUST set intent:"sentiment", dataset:"customer_feedback", analysis:["sentiment"]
- Sentiment queries MUST use text metrics only, never numeric metrics like revenue, cost, units, returns
- Pick the best dataset for the query
- Metrics should be measure columns; dimensions should be grouping/time/category columns
- Use conversation context to fill in omitted dataset or columns when needed

Examples:
Q: max and min user signups
{"intent":"ranking","dataset":"customer_behavior","metrics":["signups"],"dimensions":["week"],"analysis":["max","min"]}

Q: Are customers happy?
{"intent":"sentiment","dataset":"customer_feedback","metrics":["text"],"dimensions":["region"],"analysis":["sentiment"]}

Q: revenue by region over time
{"intent":"trend","dataset":"sales_performance","metrics":["revenue"],"dimensions":["month","region"],"analysis":["trend"]}
`;

/**
 * Parse a natural-language question into a structured analysis plan.
 * Uses Gemini API if available; falls back to local regex parsing.
 *
 * @param {string}   question
 * @param {object[]} registryMetadata  — dataset summaries (no raw data)
 * @param {object[]} conversationContext — last N messages [{ role, content }]
 * @returns {Promise<object>}  analysis plan
 */
export async function parseQuery(question, registryMetadata, conversationContext = []) {
  if (!isApiAvailable() || !_reserveApiCall()) {
    return fallbackParseQuery(question, registryMetadata);
  }

  const registryText = _buildRegistryText(registryMetadata);
  const contextText = _buildContextText(conversationContext);

  const prompt = `Available datasets:
${registryText}

Previous conversation:
${contextText}

User question: "${question}"`;

  try {
    const raw = await _callGemini(prompt, PARSE_QUERY_SYSTEM);
    const json = JSON.parse(stripMarkdownFences(raw));
    return _normalizePlan(_coerceSentimentPlan(json, question, registryMetadata), question);
  } catch (err) {
    console.warn("[geminiApi] parseQuery fell back to local:", err.message);
    return fallbackParseQuery(question, registryMetadata);
  }
}

/* ═══════════════════════════════════════════════════════════
   §4  generateNarrative
═══════════════════════════════════════════════════════════ */

const NARRATIVE_SYSTEM = `You are a data analyst explaining results to a non-technical business user.

You MUST structure EVERY response using exactly these four sections. Use the exact emoji headers:

✅ Final Answer
(1–3 plain sentences. State the key finding directly with specific numbers. No jargon.)

📊 Key Insight
(1–2 sentences. Explain the main driver, pattern, or reason behind the result. Include % change or comparison where relevant.)

📁 Data Reference
(Single line. List the exact column names or fields used to reach this answer.)

⚠️ Notes
(Any assumptions made, data limitations, or caveats. If none, write “None.”)

Rules:
- Use SPECIFIC numbers from the results with commas for readability (e.g., 12,500 not 12500).
- Do NOT hedge with “based on the data” or “according to the analysis” — state findings directly.
- Do NOT skip any section.
- Keep each section SHORT — no walls of text.
- Plain language only — no SQL, no code, no technical jargon.
- If a comparison is made, always state the % change or absolute difference.
- If the query was ambiguous, state the assumption you made in ⚠️ Notes.`;

/**
 * Generate a 2-4 sentence plain-English narrative for analysis results.
 * Uses Gemini API if available; falls back to template-based generation.
 *
 * @param {object} analysisResults — { result, metadata } from analysisOps
 * @param {string} question
 * @param {object[]} [metricDefinitions] — data-dictionary entries for context
 * @returns {Promise<string>}
 */
// export async function generateNarrative(analysisResults, question, metricDefinitions = []) {
//   // Always use deterministic local narrative templates.
//   // The Groq model (llama-3.1-8b-instant) frequently hallucinates error narratives
//   // on valid results (e.g., claiming "column not found" when the analysis succeeded).
//   // The local templates handle every result type reliably and are well-tested.
//   // Groq is still used for parseQuery (query understanding) where it performs well.
//   return fallbackNarrative(analysisResults, question);
// }
export async function generateNarrative(
  analysisResults,
  question,
  metricDefinitions = []
) {
  // 🚫 If API unavailable → fallback
  if (!isApiAvailable() || !_reserveApiCall()) {
    return fallbackNarrative(analysisResults, question);
  }

  // 🚫 If result has error → NEVER send to LLM
  if (
    !analysisResults ||
    !analysisResults.result ||
    (Array.isArray(analysisResults.result) &&
      analysisResults.result[0]?.error)
  ) {
    return fallbackNarrative(analysisResults, question);
  }

  try {
    // ✅ Build safe summary (already implemented by you)
    const summary = _buildResultSummary(
      analysisResults.result,
      analysisResults.metadata
    );

    const prompt = `
User Question:
"${question}"

Computed Results:
${summary}

Explain these results clearly.
`;

    const STRICT_NARRATIVE_SYSTEM = `
You are a professional data analyst.

You are given VERIFIED computed results from a system.
These numbers are ALWAYS correct.

Your job is ONLY to explain them clearly.

STRICT RULES:
- DO NOT invent any numbers
- DO NOT assume missing data
- ONLY use the numbers provided
- If something is missing, say "Not available"
- NEVER mention errors unless explicitly present in results
- Keep it simple and natural

FORMAT:

✅ Final Answer
(1–2 sentences, direct answer with numbers)

📊 Key Insight
(1–2 sentences explaining why)

📁 Data Reference
(List column names or fields used)

⚠️ Notes
(Assumptions or "None")
`;

    const raw = await _callGemini(prompt, STRICT_NARRATIVE_SYSTEM);

    return raw;
  } catch (err) {
    console.warn("[geminiApi] Narrative fell back to local:", err.message);
    return fallbackNarrative(analysisResults, question);
  }
}

/** Build a compact text summary of results to send to Gemini (no raw rows). */
function _buildResultSummary(result, metadata) {
  if (!result) return "(no results)";

  const isCombinedResult = (
    result &&
    !Array.isArray(result) &&
    !result.counts &&
    !result.groups &&
    !result.topKeywords &&
    Object.values(result).some((value) =>
      Array.isArray(value) ||
      (value && typeof value === "object" && (value.counts || value.groups || value.topKeywords))
    )
  );

  if (isCombinedResult) {
    return Object.entries(result).map(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (first && typeof first === "object") {
          const metricKey = Object.keys(first).find((k) => typeof first[k] === "number" && !k.startsWith("_"));
          const labelKey = Object.keys(first).find((k) => typeof first[k] === "string" && !k.startsWith("_"));
          if (metricKey) {
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            return `${label} ${metricKey}: ${first[metricKey]}${labelKey ? ` (${first[labelKey]})` : ""}`;
          }
        }
        return `${key}: ${JSON.stringify(value[0])}`;
      }
      if (value?.counts) {
        const c = value.counts;
        return `${key}: Positive ${c.positive}, Negative ${c.negative}, Neutral ${c.neutral}, Total ${c.total}`;
      }
      return `${key}: ${JSON.stringify(value)}`;
    }).join("\n");
  }

  // sentimentScan — include groupRanking winner so Groq can name the specific group
  if (result?.counts) {
    const c = result.counts;
    let summary = `Sentiment counts — Positive: ${c.positive}, Negative: ${c.negative}, Neutral: ${c.neutral}, Total: ${c.total}`;
    if (result.groupRanking && result.groupRanking.length > 0) {
      const worst = result.groupRanking[0];
      const best  = result.groupRanking[result.groupRanking.length - 1];
      summary += `\nGroup ranking (worst to best): ${result.groupRanking.map((g) => `${g.group}(neg:${g.negativeRate}%,pos:${g.positiveRate}%)`).join(", ")}`;
      summary += `\nWorst group: "${worst.group}" (${worst.negativeRate}% negative, ${worst.negative} negative entries)`;
      summary += `\nBest group: "${best.group}" (${best.positiveRate}% positive, ${best.positive} positive entries)`;
    }
    return summary;
  }
  // compare
  if (result?.groups && result?.comparisons) {
    const g = result.groups.slice(0, 4).map((g) => JSON.stringify(g)).join(", ");
    const top = result.comparisons[0];
    return `Groups: [${g}]${top ? `\nBiggest gap: ${top.groupA} vs ${top.groupB} on ${top.metricCol}: diff=${top.diff}` : ""}`;
  }
  // extractThemes
  if (result?.topKeywords) {
    return `Top keywords: ${result.topKeywords.slice(0, 8).map((k) => `${k.word}(${k.count})`).join(", ")}`;
  }

  // Array results
  if (Array.isArray(result)) {
    if (result[0]?.error) return `Error: ${result[0].error}`;

    // Limit to first 8 rows, summarise key fields
    return result.slice(0, 8).map((row) => {
      const clean = {};
      for (const [k, v] of Object.entries(row)) {
        if (!k.startsWith("_")) clean[k] = v; // drop internal _ fields
      }
      return JSON.stringify(clean);
    }).join("\n");
  }

  return JSON.stringify(result).slice(0, 600);
}

/* ═══════════════════════════════════════════════════════════
   §5  fallbackParseQuery  (LOCAL — no API)
═══════════════════════════════════════════════════════════ */

/* ── Column synonym map: user term → actual column name ── */
const COLUMN_SYNONYMS = {
  sales:         "revenue",
  income:        "revenue",
  earnings:      "revenue",
  profit:        "revenue",
  users:         "active_users",
  "active users": "active_users",
  customers:     "active_users",
  attrition:     "churn",
  "churn rate":  "churn",
  cancellations: "churn",
  "sign ups":    "signups",
  "new users":   "signups",
  registrations: "signups",
  spend:         "ad_spend",
  spending:      "ad_spend",
  advertising:   "ad_spend",
  expenses:      "cost",
  costs:         "cost",
  employees:     "headcount",
  staff:         "headcount",
  "team size":   "headcount",
  satisfaction:  "nps",
  "handle time": "avg_handle_time",
  response:      "resolution_rate",
  period:        "month",
  time:          "month",
};

/** Map a user-provided term to an actual column name using synonyms. */
function _synonymResolve(term) {
  return COLUMN_SYNONYMS[term.toLowerCase()] ?? null;
}

/* ── Intent keyword tables ── */
const INTENT_RULES = [
  // text_search must come first — most specific
  { intent: "text_search", patterns: [/\bsearch\b/, /\bfind\b.*feedback/, /\bmention/i, /\babout\b.*customers/i] },
  // sentiment before ranking — "worst feedback" / "best month for feedback" should be sentiment
  {
    intent: "sentiment",
    patterns: [
      /\bsentiment\b/,
      /\bcomplaint/i,
      /\bcomplaints\b/,
      /\bwhat are customers/i,
      /\bcustomers say/i,
      /\bfeedback\b/,
      /\breviews?\b/i,
      /\bunhappy\b/i,
      /\bdissatisfied\b/i,
      /worst.*month/i,
      /best.*month/i,
      /month.*worst/i,
      /month.*best/i,
      /which month.*bad/i,
      /which month.*good/i,
    ],
  },
  // computed_metric: explicit rate / margin / per-unit
  { intent: "computed_metric", patterns: [
    /profit margin/i, /cost per/i, /per unit/i, /\bratio\b/i, /\befficiency\b/i, /\brate\b.*per/i,
    /churn rate/i, /return rate/i, /attrition rate/i, /conversion rate/i,
  ] },
  { intent: "anomaly", patterns: [/\banomal/i, /\bunusual\b/i, /\boutlier/i, /\bspike\b/i, /\babnormal\b/i, /\bflag\b/i] },
  { intent: "correlation", patterns: [/\bcorrelat/i, /relationship between/i, /\brelated to\b/i, /\bimpact on\b/i, /\bcontribut/i, /what drives/i, /what causes/i, /what affects/i] },
  { intent: "trend", patterns: [
    /\bwhy\b.*change/i, /\bwhy\b.*drop/i, /\bwhy\b.*increase/i,
    /\btrend\b/i, /\bchanged\b/i, /\bdrop(ped)?\b/i, /\bincreas/i,
    /\brise\b|\brose\b/i, /\bwhat happened/i, /\bcause\b/i, /\breason\b/i,
    /over time/i,
    // ─ "every month/week", "per month/week", "each month" ─
    /every (month|week|day)/i, /per (month|week|day)/i, /each (month|week)/i,
    /month[- ]by[- ]month/i, /week[- ]by[- ]week/i,
    /\bmonthly\b/i, /\bweekly\b/i,
    // churn/NPS/metric over time
    /nps.*over/i, /over.*month/i, /over.*week/i,
    // "how is X trending", "how did X change"
    /how (is|did|has)\b/i,
  ] },
  { intent: "comparison", patterns: [/\bcompare\b/i, /\bvs\b\.?/i, /\bversus\b/i, /difference between/i, /\bagainst\b/i] },
  { intent: "breakdown", patterns: [
    /\bbreakdown\b/i, /\bbreak down\b/i, /what makes up/i, /\bcomposition\b/i,
    /by (department|region|product|channel|category)/i,
    /\bdistribution\b/i, /\bsplit\b/i, /\bshare\b/i,
  ] },
  { intent: "ranking", patterns: [
    /\btop \d/i, /\bbottom \d/i, /\bhighest\b/i, /\blowest\b/i,
    /\bbest\b/i, /\bworst\b/i, /\brank/i, /\bmost\b/i, /\bleast\b/i,
    /\bmax\b/i, /\bmin\b/i, /\bmaximum\b/i, /\bminimum\b/i,
    /which.*most/i, /which.*least/i, /which.*max/i, /which.*min/i,
    /who.*most/i, /who.*least/i, /who.*highest/i, /who.*lowest/i,
  ] },
  // aggregate: explicit total/average/sum/count
  { intent: "aggregate", patterns: [
    /\btotal\b/i, /\baverage\b/i, /\bsum\b/i, /\bmean\b/i,
    /how much\b/i, /how many\b/i, /what is the\b.*\b(revenue|cost|churn|signups|units|headcount)/i,
  ] },
  { intent: "summary", patterns: [/\bsummar/i, /\boverview\b/i, /\bhighlights\b/i, /what.?s happening/i, /\bupdate\b/i, /\bbrief\b/i, /\bhow are we doing\b/i, /recent performance/i] },
];

/** Detect intent from the question using ordered keyword rules. Returns "summary" as default. */
function _detectIntent(q) {
  const lower = q.toLowerCase();

  // Pre-check: "weekly summary", "monthly overview" etc. → summary, not trend
  // Without this, "weekly" matches trend patterns before "summary" gets a chance.
  if (/\b(summar|overview|highlight|brief|update|insight|recap)\b/i.test(lower) &&
      /\b(weekly|monthly|daily|quarterly)\b/i.test(lower)) {
    return "summary";
  }

  if (_isSentimentQuery(lower)) {
    return "sentiment";
  }

  for (const { intent, patterns } of INTENT_RULES) {
    if (patterns.some((p) => p.test(lower))) return intent;
  }
  return "summary";
}

function _detectAnalysisTypes(question, intent) {
  const lower = question.toLowerCase();
  const analyses = [];
  const hasMax = /\b(max|maximum|highest|top|best|most)\b/i.test(lower);
  const hasMin = /\b(min|minimum|lowest|bottom|worst|least)\b/i.test(lower);

  if (hasMax) analyses.push("max");
  if (hasMin) analyses.push("min");
  if (/\b(compare|vs\.?|versus|against|difference between)\b/i.test(lower) || intent === "comparison") {
    analyses.push("comparison");
  }
  if (/\b(trend|over time|month over month|week over week|changed|change|increase|decrease|growth)\b/i.test(lower) || intent === "trend") {
    analyses.push("trend");
  }
  if (intent === "sentiment" || _isSentimentQuery(lower)) analyses.push("sentiment");
  if (intent === "text_search") analyses.push("text_search");
  if (intent === "breakdown") analyses.push("breakdown");
  if (intent === "anomaly") analyses.push("anomaly");
  if (intent === "correlation") analyses.push("correlation");
  if (intent === "computed_metric") analyses.push("computed_metric");

  if (analyses.length === 0) {
    if (intent === "ranking") analyses.push(hasMin && !hasMax ? "min" : "max");
    else analyses.push(intent);
  }

  return [...new Set(analyses)];
}

/** Score each dataset by how many of its column names appear in the question. */
function _scoreDataset(question, dataset) {
  const lower = question.toLowerCase();
  let score = 0;
  // Bonus if dataset name appears
  if (lower.includes(dataset.name.toLowerCase())) score += 5;
  for (const col of dataset.columns ?? []) {
    if (lower.includes(col.name.toLowerCase())) score += 2;
  }
  return score;
}

/** Find the best-matching dataset for a question. Returns the dataset object. */
function _pickDataset(question, registryMetadata, intent) {
  if (!registryMetadata || registryMetadata.length === 0) return null;

  const lower = question.toLowerCase();
  const feedbackDataset = _findFeedbackDataset(registryMetadata);

  // ── Force feedback dataset for text/sentiment intents ──
  if (intent === "text_search" || intent === "sentiment" || _isSentimentQuery(lower)) {
    if (feedbackDataset) return feedbackDataset;
  }

  // ── Domain keyword shortcuts (real dataset columns) ──
  // Customer Behavior keywords
  const customerKw = ["churn", "signups", "nps", "active_users", "active users", "tickets",
                      "resolution_rate", "avg_handle_time", "handle time", "week"];
  // Financial Reports (Costs) keywords
  const costsKw    = ["department", "headcount", "category", "q1", "q2", "q3", "q4", "quarterly", "quarter"];
  // Customer Feedback keywords
  const feedbackKw = ["feedback", "complaint", "review", "text", "qualitative"];

  const matchCustomer = customerKw.some((k) => lower.includes(k));
  const matchCosts    = costsKw.some((k) => lower.includes(k));
  const matchFeedback = feedbackKw.some((k) => lower.includes(k));

  if (matchFeedback && !matchCustomer && !matchCosts) {
    const ds = registryMetadata.find((d) => d.name.toLowerCase().includes("feedback"));
    if (ds) return ds;
  }
  if (matchCustomer && !matchCosts) {
    const ds = registryMetadata.find((d) => d.name.toLowerCase().includes("customer") && !d.name.toLowerCase().includes("feedback"));
    if (ds) return ds;
  }
  if (matchCosts && !matchCustomer) {
    const ds = registryMetadata.find((d) => d.name.toLowerCase().includes("financial"));
    if (ds) return ds;
  }

  // ── Column-name scoring fallback ──
  const scored = registryMetadata
    .map((ds) => ({ ds, score: _scoreDataset(question, ds) }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.ds ?? registryMetadata[0];
}

/**
 * Find which columns from a dataset are mentioned in the question.
 * Uses both exact column name matching AND synonyms.
 */
function _findMentionedColumns(question, dataset) {
  const lower = question.toLowerCase();
  const cols = dataset?.columns ?? [];
  const found = new Set();

  // 1. Direct column name match
  for (const c of cols) {
    if (lower.includes(c.name.toLowerCase())) found.add(c.name);
  }

  // 2. Synonym match: if user says "sales", map to "revenue" if it exists
  for (const [synonym, colName] of Object.entries(COLUMN_SYNONYMS)) {
    if (lower.includes(synonym)) {
      const match = cols.find((c) => c.name.toLowerCase() === colName.toLowerCase());
      if (match) found.add(match.name);
    }
  }

  return [...found];
}

/** Return the first column of a given type from a dataset. */
function _firstColOfType(dataset, type) {
  return (dataset?.columns ?? []).find((c) => c.type === type)?.name ?? null;
}

/** Return all column names of a given type from a dataset. */
function _colsOfType(dataset, type) {
  return (dataset?.columns ?? []).filter((c) => c.type === type).map((c) => c.name);
}

/**
 * Extract a number N from "top 5", "bottom 3" etc.
 * For max/min/maximum/minimum without explicit N, default to 1 (user wants THE max).
 */
function _extractN(question, defaultN = 5) {
  const m = question.match(/\b(top|bottom)\s+(\d+)\b/i);
  if (m) return parseInt(m[2], 10);
  // "max" / "min" / "maximum" / "minimum" without an explicit N → user wants 1 row
  if (/\b(max|min|maximum|minimum)\b/i.test(question)
    && !/\btop\s+\d/i.test(question)
    && !/\bbottom\s+\d/i.test(question)) {
    return 1;
  }
  return defaultN;
}

/** Choose chart type for an intent. */
function _chartForIntent(intent) {
  const map = {
    breakdown: "pie",
    comparison: "bar",
    trend: "line",
    ranking: "bar",
    summary: "bar",
    anomaly: "table",
    computed_metric: "bar",
    text_search: "table",
    sentiment: "pie",
    correlation: "table",
    aggregate: "bar",
  };
  return map[intent] ?? "table";
}

/** Build a title from intent + primary columns. */
function _makeTitle(intent, dataset, columns) {
  const ds = dataset?.name ?? "Data";
  const cols = columns.slice(0, 2).join(" & ") || ds;
  const labels = {
    breakdown: `Breakdown of ${cols}`,
    comparison: `Comparison by ${cols}`,
    trend: `${cols} Trend Over Time`,
    ranking: `Top ${cols}`,
    summary: `${ds} Summary`,
    anomaly: `Anomalies in ${cols}`,
    correlation: `Correlation: ${cols}`,
    computed_metric: `Computed: ${cols}`,
    text_search: `Feedback Search`,
    sentiment: `Sentiment Analysis`,
    aggregate: `${cols} Total`,
  };
  return labels[intent] ?? `${ds} Analysis`;
}

/** Build an operations array for each intent. */
function _buildOperations(intent, question, dataset) {
  const timeCol     = _firstColOfType(dataset, "date");
  const numericCols = _colsOfType(dataset, "numeric");
  const catCols     = _colsOfType(dataset, "categorical");
  const textCols    = _colsOfType(dataset, "text");
  const mentioned   = _findMentionedColumns(question, dataset);

  // Is this a text-only dataset? (no numeric columns at all)
  const isTextOnly = numericCols.length === 0;

  // Pick primary metric: first mentioned numeric, or first numeric col
  const primaryMetric = mentioned.find((c) =>
    (dataset?.columns ?? []).find((col) => col.name === c && col.type === "numeric")
  ) ?? numericCols[0] ?? null;

  // Pick primary group: first mentioned categorical OR date, or first cat col
  const primaryGroup = mentioned.find((c) =>
    (dataset?.columns ?? []).find((col) => col.name === c && (col.type === "categorical" || col.type === "date"))
  ) ?? catCols[0] ?? timeCol ?? null;

  // ── Safety: if a required column is missing, refuse rather than pass undefined ──
  function requireCol(col, role) {
    if (col !== undefined && col !== null) return col;
    const available = (dataset?.columns ?? []).map((c) => c.name).join(", ") || "(none)";
    throw new Error(
      `Cannot build ${intent} operation: no ${role} column found. Available columns: ${available}`
    );
  }

  switch (intent) {
    case "breakdown":
      // Text-only: group by cat/date and scan sentiment per group
      if (isTextOnly) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: primaryGroup } }];
      }
      return primaryMetric && primaryGroup
        ? [{ function: "breakdown", params: { metricCol: primaryMetric, groupCol: primaryGroup } }]
        : [{ function: "aggregate", params: { metricCol: requireCol(primaryMetric ?? numericCols[0], "metric"), groupCol: primaryGroup, aggType: "sum" } }];

    case "comparison": {
      if (isTextOnly) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: primaryGroup } }];
      }
      const lower = question.toLowerCase();

      // Detect column-series comparison: e.g. "compare Q1, Q2, Q3, Q4"
      const quarterCols = numericCols.filter((c) => /^Q[1-4]$/i.test(c));
      const asksAboutQuarter = /\bquarter\b|\bQ[1-4]\b/i.test(question);
      if (quarterCols.length > 1 && asksAboutQuarter) {
        return [{ function: "rankColumns", params: { columns: quarterCols, direction: "top" } }];
      }

      // Detect temporal comparison: "week by week", "month by month", "compare X over time", "for all weeks", etc.
      const isTemporal = /week[- ]by[- ]week|month[- ]by[- ]month|over time|every (week|month)|per (week|month)|\bweekly\b|\bmonthly\b|for all (week|month)|all weeks|all months|across (week|month)|each (week|month)|by week|by month/i.test(lower);
      if (isTemporal && timeCol) {
        return [{
          function: "trend",
          params: {
            timeCol: timeCol,
            metricCol: requireCol(primaryMetric ?? numericCols[0], "metric"),
            groupCol: null,
          },
        }];
      }

      // Detect specific period comparison: "Jan vs Feb", "W1 vs W2", "this week vs last week"
      const vsMatch = lower.match(/(\w[\w\s]*?)\s+vs\.?\s+(\w[\w\s]*?)(?:\s|$)/i);
      if (vsMatch && timeCol) {
        const periodA = vsMatch[1].trim();
        const periodB = vsMatch[2].trim();
        // Use compare operation grouped by time column, which gives per-period stats
        // This handles "Jan vs Feb", "W1 vs W2" etc. by comparing across periods
        return [{
          function: "compare",
          params: {
            groupCol: timeCol,
            metricCols: primaryMetric
              ? [primaryMetric]
              : numericCols.slice(0, 3),
          },
        }];
      }

      // Default: compare groups across metrics
      return [{ function: "compare", params: { groupCol: primaryGroup, metricCols: numericCols.slice(0, 3) } }];
    }

    case "trend": {
      if (isTextOnly) {
        // Trend of sentiment over time
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: timeCol ?? primaryGroup } }];
      }
      const lower = question.toLowerCase();
      const includeDrivers = /\bwhy\b|\bdriver\b|\bcause\b/.test(lower);
      return [{
        function: "trend",
        params: {
          timeCol: requireCol(timeCol ?? catCols[0], "time"),
          metricCol: requireCol(primaryMetric ?? numericCols[0], "metric"),
          groupCol: includeDrivers ? primaryGroup : null,
        },
      }];
    }

    case "ranking": {
      if (isTextOnly) {
        // Rank time/group periods by sentiment
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: primaryGroup ?? timeCol } }];
      }
      // Detect "which quarter/Q1-Q4" style: comparing COLUMNS rather than ROWS
      const quarterCols = numericCols.filter((c) => /^Q[1-4]$/i.test(c));
      const asksAboutQuarter = /\bquarter\b|\bQ[1-4]\b/i.test(question);
      if (quarterCols.length > 1 && asksAboutQuarter) {
        const isQBottom = /\bworst\b|\blowest\b|\bbottom\b|\bleast\b|\bmin\b|\bminimum\b/i.test(question);
        return [{ function: "rankColumns", params: { columns: quarterCols, direction: isQBottom ? "bottom" : "top" } }];
      }
      // max/maximum → top (highest), min/minimum/lowest/worst → bottom
      const isBottom = /\bbottom\b|\blowest\b|\bworst\b|\bleast\b|\bmin\b|\bminimum\b/i.test(question)
                    && !/\bmax\b|\bmaximum\b|\bhighest\b|\bbest\b|\btop\b/i.test(question);
      return [{
        function: "topN",
        params: {
          metricCol: requireCol(primaryMetric ?? numericCols[0], "metric"),
          n: _extractN(question),
          direction: isBottom ? "bottom" : "top",
        },
      }];
    }

    case "anomaly":
      if (isTextOnly) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: primaryGroup } }];
      }
      return [{ function: "anomaly", params: { metricCol: requireCol(primaryMetric ?? numericCols[0], "metric"), threshold: 20 } }];

    case "correlation": {
      if (isTextOnly || numericCols.length < 2) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text" } }];
      }
      const col1 = primaryMetric ?? numericCols[0];
      const col2 = mentioned.find((c) =>
        c !== col1 && numericCols.includes(c)
      ) ?? numericCols.find((c) => c !== col1) ?? numericCols[1];
      return [{
        function: "correlation",
        params: { col1, col2 },
      }];
    }

    case "computed_metric": {
      if (isTextOnly) {
        return [{ function: "summarize", params: { columns: [] } }];
      }
      const lower = question.toLowerCase();

      // Auto-detect common rate formulas
      const isChurnRate  = /churn rate|attrition rate/i.test(lower);
      const isReturnRate = /return rate/i.test(lower);
      const isMargin     = /margin/i.test(lower);

      if (isChurnRate) {
        const hasChurn = numericCols.some((c) => c.toLowerCase() === "churn");
        const hasUsers = numericCols.some((c) => c.toLowerCase() === "active_users");
        if (hasChurn && hasUsers) {
          return [{
            function: "computeMetric",
            params: {
              formula: { operation: "ratio", numerator: "churn", denominator: "active_users" },
              resultName: "Churn Rate (%)",
              groupCol: timeCol ?? primaryGroup,
            },
          }];
        }
      }
      if (isReturnRate) {
        const hasReturns = numericCols.some((c) => c.toLowerCase() === "returns");
        const hasUnits   = numericCols.some((c) => c.toLowerCase() === "units");
        if (hasReturns && hasUnits) {
          return [{
            function: "computeMetric",
            params: {
              formula: { operation: "ratio", numerator: "returns", denominator: "units" },
              resultName: "Return Rate (%)",
              groupCol: timeCol ?? primaryGroup,
            },
          }];
        }
      }
      if (isMargin) {
        return [{
          function: "computeMetric",
          params: {
            formula: {
              operation: "ratio",
              numerator: { operation: "subtract", left: "revenue", right: "cost" },
              denominator: "revenue",
            },
            resultName: "Profit Margin",
            groupCol: primaryGroup,
          },
        }];
      }

      return [{
        function: "computeMetric",
        params: {
          formula: { operation: "subtract", left: requireCol(numericCols[0], "first numeric"), right: requireCol(numericCols[1], "second numeric") },
          resultName: "Computed Metric",
          groupCol: primaryGroup,
        },
      }];
    }

    case "text_search": {
      const textCol = textCols[0] ?? "text";
      const termMatch = question.match(/(?:search|find|about|mention(?:ing)?|mentions)\s+(.+)/i);
      const queryStr = termMatch ? termMatch[1].replace(/[?"'.]/g, "").trim() : question;
      return [{ function: "searchText", params: { textCol, query: queryStr } }];
    }

    case "sentiment": {
      // Prefer explicit region/location/category in the question as groupCol.
      // Fall back to timeCol for "which month had worst feedback" style questions.
      const lower = question.toLowerCase();
      const prefersRegion = /\bregion\b|\blocation\b|\barea\b|\bcity\b|\bcountry\b|\bstate\b|\bzone\b/i.test(lower);
      const prefersCat    = catCols.find((c) => lower.includes(c.toLowerCase()) && c.toLowerCase() !== "channel");

      let sentGroupCol;
      if (prefersRegion) {
        // pick the cat column most likely to be region
        sentGroupCol = catCols.find((c) => /region|location|area|zone/i.test(c)) ?? catCols.find((c) => c !== timeCol);
      } else if (prefersCat) {
        sentGroupCol = prefersCat;
      } else {
        sentGroupCol = timeCol ?? primaryGroup;
      }

      return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: sentGroupCol } }];
    }

    case "aggregate": {
      if (isTextOnly) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text" } }];
      }
      const lower = question.toLowerCase();
      let aggType = "sum";
      if (/\baverage\b|\bavg\b|\bmean\b/i.test(lower)) aggType = "avg";
      else if (/\bhow many\b|\bcount\b/i.test(lower)) aggType = "count";

      return [{
        function: "aggregate",
        params: {
          metricCol: requireCol(primaryMetric ?? numericCols[0], "metric"),
          groupCol: primaryGroup !== primaryMetric ? primaryGroup : null,
          aggType,
        }
      }];
    }

    case "summary":
    default:
      if (isTextOnly) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text" } }];
      }
      return [{ function: "summarize", params: { columns: numericCols.slice(0, 6) } }];
  }
}

/**
 * Local (no API) query parser using keyword-based intent detection and heuristic column matching.
 * Returns the same shape as parseQuery.
 *
 * @param {string}   question
 * @param {object[]} registryMetadata
 * @returns {object}  analysis plan
 */
export function fallbackParseQuery(question, registryMetadata) {
  const intent = _detectIntent(question);
  const dataset = _pickDataset(question, registryMetadata, intent);
  const analysis = _detectAnalysisTypes(question, intent);

  const mentioned = _findMentionedColumns(question, dataset);
  const numericCols = _colsOfType(dataset, "numeric");
  const catCols = _colsOfType(dataset, "categorical");
  const dateCols = _colsOfType(dataset, "date");
  const textCols = _colsOfType(dataset, "text");
  const primaryMetric = mentioned.find((c) => numericCols.includes(c)) ?? numericCols[0] ?? textCols[0];
  const primaryGroup = mentioned.find((c) => catCols.includes(c) || dateCols.includes(c)) ?? catCols[0] ?? dateCols[0];
  const sentimentQuery = intent === "sentiment" || _isSentimentQuery(question);
  const metrics = sentimentQuery
    ? [textCols[0] ?? "text"]
    : [...new Set([primaryMetric].filter(Boolean))];
  const dimensions = [...new Set([primaryGroup].filter(Boolean))];
  const effectiveIntent = sentimentQuery ? "sentiment" : intent;

  return _normalizePlan(_coerceSentimentPlan({
    intent: effectiveIntent,
    dataset: dataset?.id ?? dataset?.name ?? "",
    metrics,
    dimensions,
    analysis,
    datasets: dataset ? [dataset.name] : [],
    columns: [...new Set([...metrics, ...dimensions])],
    operations: [],
    chartType: _chartForIntent(effectiveIntent),
    title: _makeTitle(effectiveIntent, dataset, [...metrics, ...dimensions]),
  }, question, registryMetadata), question);
}

/* ═══════════════════════════════════════════════════════════
   §6  fallbackNarrative  (LOCAL — no API)
═══════════════════════════════════════════════════════════ */

/** Safely get a value from a row, handling missing keys. */
const _get = (obj, key) => obj?.[key] ?? obj?.[Object.keys(obj ?? {}).find((k) => k.toLowerCase() === key?.toLowerCase())] ?? null;

/**
 * Wrap a plain narrative string into the 4-section structured format.
 * Used by fallbackNarrative and the Groq narrative post-processor.
 *
 * @param {string} finalAnswer  — the core 1-3 sentence answer
 * @param {string} keyInsight   — main driver or pattern
 * @param {string} dataRef      — comma-separated column/field names used
 * @param {string} notes        — assumptions or caveats (or "None.")
 */
function _wrapStructured(finalAnswer, keyInsight, dataRef, notes) {
  return [
    `✅ **Final Answer**\n${finalAnswer}`,
    `📊 **Key Insight**\n${keyInsight}`,
    `📁 **Data Reference**\n${dataRef}`,
    `⚠️ **Notes**\n${notes || "None."}`,
  ].join("\n\n");
}

/**
 * Template-based narrative generator — fully offline.
 * Infers the result type from the result shape and metadata.method.
 *
 * @param {object} analysisResults — { result, metadata }
 * @param {string} question
 * @returns {string}
 */
export function fallbackNarrative(analysisResults, question) {
  const { result, metadata } = analysisResults ?? {};
  const method = metadata?.method ?? "";
  const colsUsed = (metadata?.columnsUsed ?? []).join(", ") || "unknown fields";
  const rows = metadata?.rowsAnalyzed ?? "?";
  const analysisKeys = metadata?.analysisKeys ?? [];

  if (!result) return _wrapStructured(
    "No results were returned for this query.",
    "The analysis could not produce a result.",
    colsUsed,
    "Try rephrasing your question or checking available datasets."
  );
  if (Array.isArray(result) && result.length > 0 && result[0]?.error) {
    return _wrapStructured(
      result[0].error,
      "The requested column or operation could not be completed.",
      colsUsed,
      "Check that the column name exists in the dataset."
    );
  }

  if (
    analysisKeys.length > 1 ||
    (result &&
      !Array.isArray(result) &&
      !result.counts &&
      !result.groups &&
      Object.values(result).some((value) => Array.isArray(value) || (value && typeof value === "object")))
  ) {
    return _wrapStructured(
      _buildResultSummary(result, metadata),
      `Completed ${analysisKeys.length || Object.keys(result).length} analyses for the same query without dropping intermediate results.`,
      colsUsed,
      `Rows analyzed: ${rows}.`
    );
  }

  /* ── sentimentScan: { counts, groups, groupRanking? } ── */
  if (result?.counts && result?.groups) {
    const c     = result.counts;
    const total = c.total || 1;
    const posPct = Math.round((c.positive / total) * 100);
    const negPct = Math.round((c.negative / total) * 100);
    const neuPct = Math.round((c.neutral  / total) * 100);
    const tone   = c.positive > c.negative ? "predominantly positive"
                 : c.negative > c.positive ? "predominantly negative"
                 : "mixed";

    const ranking = result.groupRanking;
    if (ranking && ranking.length > 0) {
      const worst = ranking[0];
      const best  = ranking[ranking.length - 1];
      const isWorstQ = /worst|bad|negative|complain/i.test(question);
      const isBestQ  = /best|good|positive|happy|satisf/i.test(question);

      let finalAnswer = "";
      let keyInsight  = "";

      if (isWorstQ && !isBestQ) {
        finalAnswer = `**${worst.group}** had the worst feedback — ${worst.negativeRate}% negative sentiment (${worst.negative} of ${worst.total} entries).`;
        keyInsight  = ranking.length > 1
          ? `**${ranking[1].group}** was second worst at ${ranking[1].negativeRate}% negative. Overall sentiment is ${tone} (${posPct}% positive, ${negPct}% negative).`
          : `Overall sentiment is ${tone}: ${posPct}% positive, ${negPct}% negative, ${neuPct}% neutral.`;
      } else if (isBestQ && !isWorstQ) {
        finalAnswer = `**${best.group}** had the best feedback — ${best.positiveRate}% positive sentiment (${best.positive} of ${best.total} entries).`;
        keyInsight  = `Overall sentiment is ${tone}: ${posPct}% positive, ${negPct}% negative, ${neuPct}% neutral across all ${total} entries.`;
      } else {
        const rankSummary = ranking.slice(0, 3)
          .map((g) => `${g.group}: ${g.negativeRate}% negative, ${g.positiveRate}% positive`)
          .join(" | ");
        finalAnswer = `Sentiment breakdown across periods. Overall: ${tone} — ${posPct}% positive, ${negPct}% negative, ${neuPct}% neutral.`;
        keyInsight  = rankSummary;
      }

      return _wrapStructured(
        finalAnswer,
        keyInsight,
        colsUsed,
        `Based on ${total} feedback entries. Sentiment scored using keyword matching.`
      );
    }

    return _wrapStructured(
      `Sentiment across ${total} feedback entries is **${tone}**: ${posPct}% positive, ${negPct}% negative, and ${neuPct}% neutral.`,
      `${c.positive} positive entries vs ${c.negative} negative entries. ${neuPct}% were neutral or ambiguous.`,
      colsUsed,
      "Sentiment scored using keyword matching — not a trained NLP model."
    );
  }

  /* ── rankColumns: [{ name, total, rank }] ── */
  if (Array.isArray(result) && result.length > 0 && result[0]?.rank !== undefined && result[0]?.total !== undefined && result[0]?.name !== undefined) {
    const top    = result[0];
    const second = result[1];
    const isWorstQ = /worst|lowest|bottom|least/i.test(question);
    const label  = isWorstQ ? "lowest" : "highest";

    const finalAnswer = `**${top.name}** had the ${label} total at **${formatNumber(top.total)}**${second ? `, followed by **${second.name}** (${formatNumber(second.total)})` : ""}.`;
    const allRanked   = result.map((r) => `${r.name}: ${formatNumber(r.total)}`).join(" → ");
    const keyInsight  = `Full ranking: ${allRanked}`;

    return _wrapStructured(
      finalAnswer,
      keyInsight,
      colsUsed,
      `Totals are summed across all ${rows} rows in the dataset.`
    );
  }

  /* ── extractThemes: { topKeywords, themeClusters } ── */
  if (result?.topKeywords) {
    const topWords = result.topKeywords.slice(0, 5).map((k) => k.word).join(", ");
    const clusterCount = result.themeClusters?.length ?? 0;
    const topCluster = result.themeClusters?.[0];

    return _wrapStructured(
      `The top recurring themes are: **${topWords}**. These form ${clusterCount} distinct topic cluster${clusterCount !== 1 ? "s" : ""} in the feedback.`,
      topCluster ? `The dominant cluster is "${topCluster.theme}" with ${topCluster.count} entries mentioning related keywords: ${topCluster.keywords.join(", ")}.` : "Themes extracted from word frequency analysis.",
      colsUsed,
      `Analysis across ${rows} feedback entries. Stop words removed before counting.`
    );
  }

  /* ── compare: { groups, comparisons } ── */
  if (result?.groups && result?.comparisons) {
    const groups = result.groups;
    if (groups.length < 2) return _wrapStructured(
      "Comparison requires at least two groups.",
      "Not enough groups found in the data to compare.",
      colsUsed, "None."
    );

    const metric = Object.keys(groups[0]).find((k) => k !== "group" && typeof groups[0][k] === "object");
    const g1 = groups[0];
    const g2 = groups[1];
    const topCmp = result.comparisons.find((c) => c._biggestGap) ?? result.comparisons[0];
    const g1Total = metric ? g1[metric]?.total : null;
    const g2Total = metric ? g2[metric]?.total : null;

    if (topCmp && g1Total !== null && g2Total !== null) {
      const leader = g1Total > g2Total ? g1.group : g2.group;
      const follower = g1Total > g2Total ? g2.group : g1.group;
      const leaderVal = Math.max(g1Total, g2Total);
      const diff = topCmp.diffPct !== null ? ` (${topCmp.diffPct > 0 ? "+" : ""}${formatPercent(topCmp.diffPct)} difference)` : "";

      return _wrapStructured(
        `**${leader}** leads with **${formatNumber(leaderVal)}** compared to **${follower}**${diff}.`,
        `The largest performance gap is in **${topCmp.metricCol}**. This metric drives the overall difference between the two groups.`,
        colsUsed,
        `Comparison across ${rows} rows.`
      );
    }
    return _wrapStructured(
      `Compared ${groups.map((g) => g.group).join(", ")} across ${colsUsed}.`,
      "No dominant gap detected between groups.",
      colsUsed, "None."
    );
  }

  if (!Array.isArray(result) || result.length === 0) {
    return _wrapStructured(
      "The analysis returned no results.",
      "No matching rows or values were found for this query.",
      colsUsed,
      "Try broadening your question or checking if the data contains the values you expect."
    );
  }

  const first = result[0] ?? {};
  const keys = Object.keys(first).filter((k) => !k.startsWith("_"));

  /* ── searchText: rows with _highlighted ── */
  if ("_highlighted" in first) {
    const terms = first._matchedTerms?.join(", ") ?? "";
    const excerpts = result.slice(0, 2).map((r) => `"${r._highlighted}"`).join(", ");

    return _wrapStructured(
      `Found **${result.length}** matching entr${result.length === 1 ? "y" : "ies"} matching "${terms}".`,
      `Top matches: ${excerpts}`,
      colsUsed,
      `Searched ${rows} entries. Partial word matching used.`
    );
  }

  /* ── trend: rows with change + value ── */
  if ("change" in first && "value" in first) {
    const periods = result.filter((r) => r.change !== null);
    if (periods.length === 0) {
      return _wrapStructured(
        `${metadata?.columnsUsed?.[1] ?? "The metric"} trend data shows no period-over-period changes.`,
        "All periods have identical or missing comparison values.",
        colsUsed, "None."
      );
    }
    const last = periods[periods.length - 1];
    const timeKey = keys.find((k) => typeof last[k] === "string" && !["value", "change", "changePct"].includes(k));
    const metricName = metadata?.columnsUsed?.[1] ?? "the metric";
    const dir = (last.change ?? 0) >= 0 ? "increased" : "decreased";
    const pct = last.changePct !== null ? ` by ${formatPercent(Math.abs(last.changePct))}` : "";
    const periodLabel = timeKey ? ` in **${last[timeKey]}**` : "";

    let finalAnswer = `**${metricName}** ${dir}${pct}${periodLabel} to **${formatNumber(last.value)}**.`;
    let keyInsight  = last.drivers?.length > 0
      ? (() => {
          const d = last.drivers[0];
          const dd = (d.change ?? 0) >= 0 ? "increased" : "decreased";
          return `The biggest driver was **${d.group}**, which ${dd}${d.changePct !== null ? " by " + formatPercent(Math.abs(d.changePct)) : ""}.`;
        })()
      : `The trend covers ${periods.length} time periods. ${dir === "increased" ? "Growth is consistent." : "Decline may warrant attention."}`;

    return _wrapStructured(
      finalAnswer,
      keyInsight,
      colsUsed,
      `"Last period" refers to the most recent entry in the dataset (${timeKey ? last[timeKey] : "latest row"}).`
    );
  }

  /* ── breakdown: rows with share field ── */
  if ("share" in first) {
    const metricKey = keys.find((k) => k !== "share" && typeof first[k] === "number" && !k.startsWith("_")) ?? keys[1];
    const groupKey = keys.find((k) => typeof first[k] === "string" && !k.startsWith("_")) ?? keys[0];
    const top = result[0];
    const second = result[1];
    const alert = result.find((r) => r.concentrationAlert);

    const finalAnswer = `**${top[groupKey]}** accounts for **${formatPercent(top.share)}** of total ${metricKey} (${formatNumber(top[metricKey])})${second ? `, followed by **${second[groupKey]}** at ${formatPercent(second.share)}` : ""}.`;
    const keyInsight  = alert
      ? `**${alert[groupKey]}** alone exceeds 50% — indicating high concentration. This means one segment dominates the total.`
      : `The top ${Math.min(result.length, 3)} contributors account for ${formatPercent(result.slice(0, 3).reduce((s, r) => s + r.share, 0))} of the total.`;

    return _wrapStructured(
      finalAnswer,
      keyInsight,
      colsUsed,
      `Breakdown across ${rows} rows.`
    );
  }

  /* ── anomaly: rows with _deviationPct ── */
  if ("_deviationPct" in first) {
    const metricKey = keys.find((k) => !k.startsWith("_") && typeof first[k] === "number") ?? keys[0];
    const labelKey = keys.find((k) => typeof first[k] === "string" && !k.startsWith("_")) ?? keys[0];
    const mean = first._mean;
    const top = result[0];

    return _wrapStructured(
      `Found **${result.length}** anomal${result.length === 1 ? "y" : "ies"} in the data (column average: ${formatNumber(mean)}).`,
      `The most significant: **${top[labelKey] ?? "a data point"}** deviates **${formatPercent(top._deviationPct)}** from the average (value: ${formatNumber(top[metricKey])}).`,
      colsUsed,
      `Anomalies defined as values deviating more than 2 standard deviations from the mean.`
    );
  }

  /* ── summarize: rows with type + mean ── */
  if ("type" in first && "mean" in first) {
    const lines = result.slice(0, 4).map((s) => {
      if (s.error) return `${s.column}: not found`;
      if (s.type === "categorical") return `${s.column}: most common is "${s.topValue}"`;
      const arrow = s.trendPct !== null ? (s.trendPct >= 0 ? " ↑" : " ↓") : "";
      return `**${s.column}**: avg ${formatNumber(s.mean)}${s.latest !== null ? `, latest ${formatNumber(s.latest)}${arrow}` : ""}`;
    });
    const topStat = result.find((s) => s.trendPct !== null);
    const trendNote = topStat
      ? `**${topStat.column}** shows a ${topStat.trendPct >= 0 ? "positive" : "negative"} trend (${formatPercent(Math.abs(topStat.trendPct))} change period-over-period).`
      : `${result.length} columns summarised.`;

    return _wrapStructured(
      lines.join("\n"),
      trendNote,
      colsUsed,
      `Summary across ${rows} rows. Latest vs previous period comparison used where a date column exists.`
    );
  }

  /* ── correlation: rows with coefficient ── */
  if ("coefficient" in first) {
    const strength = Math.abs(first.coefficient) > 0.7 ? "strong" : Math.abs(first.coefficient) > 0.4 ? "moderate" : "weak";
    return _wrapStructured(
      `**${first.col1}** and **${first.col2}** have a **${first.interpretation}** (r = ${first.coefficient}).`,
      `A ${strength} correlation means ${Math.abs(first.coefficient) > 0.5 ? "these two metrics tend to move together" : "the relationship between these metrics is limited"}.`,
      colsUsed,
      `Correlation computed across ${rows} rows. Correlation does not imply causation.`
    );
  }

  /* ── computeMetric / topN / aggregate / generic ranked list ── */
  if (result.length > 0) {
    const metricKey = keys.find((k) => typeof first[k] === "number" && !k.startsWith("_")) ?? keys[keys.length - 1];
    const labelKey = keys.find((k) => typeof first[k] === "string" && !k.startsWith("_")) ?? keys[0];
    const top = result[0];
    const mid = result[1];
    const last = result[result.length - 1];

    const topLabel  = top[labelKey]  !== undefined ? String(top[labelKey])  : "Top entry";
    const midLabel  = mid?.[labelKey] !== undefined ? String(mid[labelKey])  : null;
    const lastLabel = last[labelKey] !== undefined ? String(last[labelKey]) : null;

    let finalAnswer = `**${topLabel}** leads with **${formatNumber(top[metricKey])}**`;
    if (midLabel) finalAnswer += `, followed by **${midLabel}** (${formatNumber(mid[metricKey])})`;
    if (result.length > 2 && lastLabel && lastLabel !== topLabel) {
      finalAnswer += `. **${lastLabel}** is at the bottom with ${formatNumber(last[metricKey])}`;
    }
    finalAnswer += ".";

    const gap = top[metricKey] && last[metricKey] && last[metricKey] !== 0
      ? ` The gap between top and bottom is ${formatNumber(top[metricKey] - last[metricKey])}.`
      : "";
    const keyInsight = `${topLabel} is the top performer across ${result.length} entries.${gap}`;

    return _wrapStructured(
      finalAnswer,
      keyInsight,
      colsUsed,
      `Ranked across ${rows} rows.`
    );
  }

  return _wrapStructured(
    method ? `Analysis complete — ${method.toLowerCase()}.` : "Analysis complete.",
    "No notable patterns detected.",
    colsUsed, "None."
  );
}
