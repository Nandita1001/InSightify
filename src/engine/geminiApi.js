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
console.log("API KEY:", import.meta.env.VITE_GROQ_API_KEY);
console.log("API AVAILABLE:", isApiAvailable());
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

/** Strip ```json ... ``` or ``` ... ``` fences Gemini sometimes wraps JSON in. */
function stripMarkdownFences(text) {
  return text
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/** Low-level Gemini POST — throws on HTTP error or missing candidates. */
async function _callGemini(prompt) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Groq API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) throw new Error("Groq returned empty response.");
  return text;
}


/** Validate and coerce an analysis plan object so consumers never crash. */
function _normalizePlan(raw) {
  const INTENTS = [
    "breakdown", "comparison", "trend", "summary", "ranking", "anomaly",
    "correlation", "computed_metric", "text_search", "sentiment",
  ];
  const CHARTS = ["pie", "bar", "line", "table", "none"];

  return {
    intent: INTENTS.includes(raw.intent) ? raw.intent : "summary",
    datasets: Array.isArray(raw.datasets) ? raw.datasets : [],
    columns: Array.isArray(raw.columns) ? raw.columns : [],
    operations: Array.isArray(raw.operations) ? raw.operations : [],
    chartType: CHARTS.includes(raw.chartType) ? raw.chartType : "table",
    title: typeof raw.title === "string" ? raw.title : "Analysis",
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

const PARSE_QUERY_SYSTEM = `You are a data analysis query parser. Given a user's question and available datasets, determine the analysis plan.

RESPOND WITH ONLY VALID JSON, no markdown, no backticks, no explanation. Use this exact structure:
{"intent":"breakdown|comparison|trend|summary|ranking|anomaly|correlation|computed_metric|text_search|sentiment","datasets":["dataset name"],"columns":["col1","col2"],"operations":[{"function":"aggregate|filter|sort|topN|trend|compare|breakdown|anomaly|correlation|computeMetric|joinDatasets|summarize|searchText|extractThemes|sentimentScan","params":{}}],"chartType":"pie|bar|line|table|none","title":"Short title"}

Rules:
- breakdown → use breakdown function with metricCol and groupCol; chartType: pie
- comparison → use compare function with groupCol and metricCols array; chartType: bar
- trend/change/why → use trend function with timeCol, metricCol, optional groupCol for driver analysis; chartType: line
- ranking (top/bottom/highest/lowest) → use topN with metricCol, n, direction; chartType: bar
- computed metrics (profit margin, cost per unit) → use computeMetric with formula object; chartType: bar
- text_search → use searchText on customer_feedback dataset; chartType: table
- sentiment → use sentimentScan on customer_feedback; chartType: pie
- summary → use summarize with relevant columns; chartType: bar
- anomaly → use anomaly with metricCol; chartType: table
- For "last month" use the most recent time period in the data; for "this quarter" use Q4
- For follow-up questions, use conversation context to fill in implicit dataset or columns`;

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

  const prompt = `${PARSE_QUERY_SYSTEM}

Available datasets:
${registryText}

Previous conversation:
${contextText}

User question: "${question}"`;

  try {
    const raw = await _callGemini(prompt);
    const json = JSON.parse(stripMarkdownFences(raw));
    return _normalizePlan(json);
  } catch (err) {
    console.warn("[geminiApi] parseQuery fell back to local:", err.message);
    return fallbackParseQuery(question, registryMetadata);
  }
}

/* ═══════════════════════════════════════════════════════════
   §4  generateNarrative
═══════════════════════════════════════════════════════════ */

const NARRATIVE_SYSTEM = `You are a data analyst explaining results to a non-technical business user.
Rules:
- Be concise: 2-4 sentences maximum.
- Use specific numbers from the results.
- Mention the data source.
- Highlight the most important finding first.
- If there's a notable pattern (concentration, outlier, sharp change), call it out explicitly.
- Use plain language, no jargon.
- Do NOT say "based on the data" or "according to the analysis" — just state the findings directly.
- Format numbers with commas for readability (e.g., 12,500 not 12500).`;

/**
 * Generate a 2-4 sentence plain-English narrative for analysis results.
 * Uses Gemini API if available; falls back to template-based generation.
 *
 * @param {object} analysisResults — { result, metadata } from analysisOps
 * @param {string} question
 * @param {object[]} [metricDefinitions] — data-dictionary entries for context
 * @returns {Promise<string>}
 */
export async function generateNarrative(analysisResults, question, metricDefinitions = []) {
  if (!isApiAvailable() || !_reserveApiCall()) {
    return fallbackNarrative(analysisResults, question);
  }

  // Build a safe, compact summary of results (no raw rows)
  const { result, metadata } = analysisResults ?? {};
  const resultSummary = _buildResultSummary(result, metadata);

  const defsText = (metricDefinitions ?? [])
    .map((d) => `${d.name}: ${d.def}`)
    .join("; ");

  const prompt = `${NARRATIVE_SYSTEM}

User question: "${question}"
Analysis method: ${metadata?.method ?? "unknown"}
Columns analyzed: ${(metadata?.columnsUsed ?? []).join(", ")}
Rows processed: ${metadata?.rowsAnalyzed ?? "unknown"}
Metric definitions: ${defsText || "none provided"}

Results summary:
${resultSummary}

Write the narrative:`;

  try {
    const text = await _callGemini(prompt);
    return text.trim();
  } catch (err) {
    console.warn("[geminiApi] generateNarrative fell back to local:", err.message);
    return fallbackNarrative(analysisResults, question);
  }
}

/** Build a compact text summary of results to send to Gemini (no raw rows). */
function _buildResultSummary(result, metadata) {
  if (!result) return "(no results)";

  // sentimentScan
  if (result?.counts) {
    const c = result.counts;
    return `Sentiment counts — Positive: ${c.positive}, Negative: ${c.negative}, Neutral: ${c.neutral}, Total: ${c.total}`;
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
      /\bfeedback\b/,           // catches "worst feedback", "best feedback"
      /\breviews?\b/i,
      /worst.*month/i,          // "worst month for feedback"
      /best.*month/i,
      /month.*worst/i,
      /month.*best/i,
      /which month.*bad/i,
      /which month.*good/i,
    ],
  },
  { intent: "computed_metric", patterns: [/profit margin/i, /cost per/i, /per unit/i, /\bratio\b/i, /\befficiency\b/i, /\brate\b.*per/i] },
  { intent: "anomaly", patterns: [/\banomal/i, /\bunusual\b/i, /\boutlier/i, /\bspike\b/i, /\babnormal\b/i, /\bflag\b/i] },
  { intent: "correlation", patterns: [/\bcorrelat/i, /relationship between/i, /\brelated to\b/i, /\bimpact on\b/i] },
  { intent: "trend", patterns: [/\bwhy\b.*change/i, /\bwhy\b.*drop/i, /\bwhy\b.*increase/i, /\btrend\b/i, /\bchanged\b/i, /\bdrop(ped)?\b/i, /\bincreas/i, /\brise\b|\brose\b/i, /\bwhat happened/i, /\bcause\b/i, /\breason\b/i, /over time/i] },
  { intent: "comparison", patterns: [/\bcompare\b/i, /\bvs\b\.?/i, /\bversus\b/i, /difference between/i, /\bagainst\b/i] },
  { intent: "breakdown", patterns: [/\bbreakdown\b/i, /\bbreak down\b/i, /what makes up/i, /\bcomposition\b/i, /by (department|region|product|channel|category)/i, /\bdistribution\b/i, /\bsplit\b/i, /\bshare\b/i] },
  { intent: "ranking", patterns: [/\btop \d/i, /\bbottom \d/i, /\bhighest\b/i, /\blowest\b/i, /\bbest\b/i, /\bworst\b/i, /\brank/i, /\bmost\b/i, /\bleast\b/i] },
  { intent: "summary", patterns: [/\bsummar/i, /\boverview\b/i, /\bhighlights\b/i, /what.?s happening/i, /\bupdate\b/i, /\bbrief\b/i, /\bhow are we doing\b/i] },
];

/** Detect intent from the question using ordered keyword rules. Returns "summary" as default. */
function _detectIntent(q) {
  const lower = q.toLowerCase();
  for (const { intent, patterns } of INTENT_RULES) {
    if (patterns.some((p) => p.test(lower))) return intent;
  }
  return "summary";
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

  // ── Force feedback dataset for text/sentiment intents ──
  if (intent === "text_search" || intent === "sentiment") {
    const fb = registryMetadata.find((d) => d.name.toLowerCase().includes("feedback"));
    if (fb) return fb;
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

/** Find which columns from a dataset are mentioned in the question (case-insensitive). */
function _findMentionedColumns(question, dataset) {
  const lower = question.toLowerCase();
  return (dataset?.columns ?? [])
    .filter((c) => lower.includes(c.name.toLowerCase()))
    .map((c) => c.name);
}

/** Return the first column of a given type from a dataset. */
function _firstColOfType(dataset, type) {
  return (dataset?.columns ?? []).find((c) => c.type === type)?.name ?? null;
}

/** Return all column names of a given type from a dataset. */
function _colsOfType(dataset, type) {
  return (dataset?.columns ?? []).filter((c) => c.type === type).map((c) => c.name);
}

/** Extract a number N from "top 5", "bottom 3" etc. */
function _extractN(question, defaultN = 5) {
  const m = question.match(/\b(top|bottom)\s+(\d+)\b/i);
  return m ? parseInt(m[2], 10) : defaultN;
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

    case "comparison":
      if (isTextOnly) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: primaryGroup } }];
      }
      // Detect column-series comparison: e.g. "compare Q1, Q2, Q3, Q4"
      {
        const quarterCols = numericCols.filter((c) => /^Q[1-4]$/i.test(c));
        const asksAboutQuarter = /\bquarter\b|\bQ[1-4]\b/i.test(question);
        if (quarterCols.length > 1 && asksAboutQuarter) {
          return [{ function: "rankColumns", params: { columns: quarterCols, direction: "top" } }];
        }
      }
      return [{ function: "compare", params: { groupCol: primaryGroup, metricCols: numericCols.slice(0, 3) } }];

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
        const isBottom = /\bworst\b|\blowest\b|\bbottom\b|\bleast\b/i.test(question);
        return [{ function: "rankColumns", params: { columns: quarterCols, direction: isBottom ? "bottom" : "top" } }];
      }
      const isBottom = /\bbottom\b|\blowest\b|\bworst\b|\bleast\b/i.test(question);
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

    case "correlation":
      if (isTextOnly || numericCols.length < 2) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text" } }];
      }
      return [{
        function: "correlation",
        params: { col1: numericCols[0], col2: numericCols[1] },
      }];

    case "computed_metric": {
      if (isTextOnly) {
        return [{ function: "summarize", params: { columns: [] } }];
      }
      const isMargin = /margin/i.test(question);
      const formulas = {
        default: { operation: "subtract", left: requireCol(numericCols[0], "first numeric"), right: requireCol(numericCols[1], "second numeric") },
        margin: {
          operation: "ratio",
          numerator: { operation: "subtract", left: "Revenue", right: "Cost" },
          denominator: "Revenue",
        },
      };
      return [{
        function: "computeMetric",
        params: {
          formula: isMargin ? formulas.margin : formulas.default,
          resultName: isMargin ? "Profit Margin" : "Computed Metric",
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

    case "sentiment":
      // groupCol allows temporal / regional breakdown of sentiment
      return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text", groupCol: timeCol ?? primaryGroup } }];

    case "summary":
    default:
      if (isTextOnly) {
        return [{ function: "sentimentScan", params: { textCol: textCols[0] ?? "text" } }];
      }
      return [{ function: "summarize", params: { columns: numericCols.slice(0, 4) } }];
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

  const mentioned = _findMentionedColumns(question, dataset);
  const numericCols = _colsOfType(dataset, "numeric");
  const catCols = _colsOfType(dataset, "categorical");
  const primaryMetric = mentioned.find((c) => numericCols.includes(c)) ?? numericCols[0];
  const primaryGroup = mentioned.find((c) => catCols.includes(c)) ?? catCols[0];
  const usedColumns = [...new Set([primaryMetric, primaryGroup, ...mentioned].filter(Boolean))];

  const operations = _buildOperations(intent, question, dataset);

  return _normalizePlan({
    intent,
    datasets: dataset ? [dataset.name] : [],
    columns: usedColumns,
    operations,
    chartType: _chartForIntent(intent),
    title: _makeTitle(intent, dataset, usedColumns),
  });
}

/* ═══════════════════════════════════════════════════════════
   §6  fallbackNarrative  (LOCAL — no API)
═══════════════════════════════════════════════════════════ */

/** Safely get a value from a row, handling missing keys. */
const _get = (obj, key) => obj?.[key] ?? obj?.[Object.keys(obj ?? {}).find((k) => k.toLowerCase() === key?.toLowerCase())] ?? null;

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

  if (!result) return "No results were returned for this query.";
  if (Array.isArray(result) && result.length > 0 && result[0]?.error) {
    return result[0].error;
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

    // If we have groupRanking, answer the "which month was worst" question directly
    const ranking = result.groupRanking;
    if (ranking && ranking.length > 0) {
      const worst = ranking[0];
      const best  = ranking[ranking.length - 1];
      const isWorstQ = /worst|bad|negative|complain/i.test(question);
      const isBestQ  = /best|good|positive|happy|satisf/i.test(question);

      let narrative = "";
      if (isWorstQ && !isBestQ) {
        narrative = `**${worst.group}** had the worst feedback with ${worst.negativeRate}% negative sentiment (${worst.negative} negative out of ${worst.total} entries, net score: ${worst.netScore}).`;
        if (ranking.length > 1) {
          const second = ranking[1];
          narrative += ` **${second.group}** was second worst at ${second.negativeRate}% negative.`;
        }
      } else if (isBestQ && !isWorstQ) {
        narrative = `**${best.group}** had the best feedback with ${best.positiveRate}% positive sentiment (${best.positive} positive out of ${best.total} entries).`;
      } else {
        // General ranking
        narrative = `Sentiment breakdown by period:\n`;
        narrative += ranking
          .map((g) => `• **${g.group}**: ${g.negativeRate}% negative, ${g.positiveRate}% positive (${g.total} entries)`)
          .join("\n");
      }
      narrative += `\n\nOverall across all ${total} entries: ${tone} — ${posPct}% positive, ${negPct}% negative, ${neuPct}% neutral.`;
      return narrative;
    }

    return `Sentiment across ${total} feedback entries is ${tone}: ${posPct}% positive, ${negPct}% negative, and ${neuPct}% neutral.`;
  }

  /* ── rankColumns: [{ name, total, rank }] ── */
  if (Array.isArray(result) && result.length > 0 && result[0]?.rank !== undefined && result[0]?.total !== undefined && result[0]?.name !== undefined) {
    const top    = result[0];
    const second = result[1];
    const isWorstQ = /worst|lowest|bottom|least/i.test(question);
    const label  = isWorstQ ? "lowest" : "highest";
    let narrative = `**${top.name}** had the ${label} total at **${formatNumber(top.total)}**`;
    if (second) {
      narrative += `, followed by **${second.name}** (${formatNumber(second.total)})`;
    }
    narrative += ".\n\n";
    narrative += result.map((r) => `• **${r.name}**: ${formatNumber(r.total)}`).join("\n");
    return narrative;
  }

  /* ── extractThemes: { topKeywords, themeClusters } ── */
  if (result?.topKeywords) {
    const topWords = result.topKeywords.slice(0, 5).map((k) => k.word).join(", ");
    const clusterCount = result.themeClusters?.length ?? 0;
    return `The top recurring themes are: ${topWords}. These form ${clusterCount} distinct topic cluster${clusterCount !== 1 ? "s" : ""} in the feedback.`;
  }

  /* ── compare: { groups, comparisons } ── */
  if (result?.groups && result?.comparisons) {
    const groups = result.groups;
    if (groups.length < 2) return "Comparison requires at least two groups.";

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
      const diff = topCmp.diffPct !== null ? ` (${topCmp.diffPct > 0 ? "+" : ""}${formatPercent(topCmp.diffPct)})` : "";
      return `${leader} leads with ${formatNumber(leaderVal)} compared to ${follower}${diff}. The largest gap is in ${topCmp.metricCol}.`;
    }
    return `Compared ${groups.map((g) => g.group).join(", ")} across ${(metadata?.columnsUsed ?? []).join(", ")}.`;
  }

  if (!Array.isArray(result) || result.length === 0) {
    return "The analysis returned no results.";
  }

  const first = result[0] ?? {};
  const keys = Object.keys(first).filter((k) => !k.startsWith("_"));

  /* ── searchText: rows with _highlighted ── */
  if ("_highlighted" in first) {
    const terms = first._matchedTerms?.join(", ") ?? "";
    const excerpts = result.slice(0, 2).map((r) => r._highlighted).join(" | ");
    return `Found ${result.length} matching entr${result.length === 1 ? "y" : "ies"} for "${terms}". ${excerpts}`;
  }

  /* ── trend: rows with changePct or change field ── */
  if ("change" in first && "value" in first) {
    const periods = result.filter((r) => r.change !== null);
    if (periods.length === 0) {
      return `${metadata?.columnsUsed?.[1] ?? "The metric"} trend data shows no period-over-period changes.`;
    }
    const last = periods[periods.length - 1];
    const timeKey = keys.find((k) => typeof last[k] === "string" && !["value", "change", "changePct"].includes(k));
    const metricName = metadata?.columnsUsed?.[1] ?? "the metric";
    const dir = (last.change ?? 0) >= 0 ? "increased" : "decreased";
    const pct = last.changePct !== null ? ` by ${formatPercent(Math.abs(last.changePct))}` : "";
    const periodLabel = timeKey ? ` in ${last[timeKey]}` : "";

    let narrative = `${metricName} ${dir}${pct}${periodLabel} (${formatNumber(last.value)}).`;

    if (last.drivers?.length > 0) {
      const topDriver = last.drivers[0];
      const driverDir = (topDriver.change ?? 0) >= 0 ? "increased" : "decreased";
      narrative += ` The biggest driver was ${topDriver.group}, which ${driverDir}${topDriver.changePct !== null ? " by " + formatPercent(Math.abs(topDriver.changePct)) : ""}.`;
    }
    return narrative;
  }

  /* ── breakdown: rows with share field ── */
  if ("share" in first) {
    const metricKey = keys.find((k) => k !== "share" && typeof first[k] === "number" && !k.startsWith("_")) ?? keys[1];
    const groupKey = keys.find((k) => typeof first[k] === "string" && !k.startsWith("_")) ?? keys[0];
    const top = result[0];
    const second = result[1];
    const alert = result.find((r) => r.concentrationAlert);

    let narrative = `${top[groupKey]} accounts for ${formatPercent(top.share)} of total ${metricKey} (${formatNumber(top[metricKey])})`;
    if (second) narrative += `, followed by ${second[groupKey]} at ${formatPercent(second.share)}`;
    narrative += ".";
    if (alert) narrative += ` Note: ${alert[groupKey]} alone exceeds 50% — high concentration.`;
    return narrative;
  }

  /* ── anomaly: rows with _deviationPct ── */
  if ("_deviationPct" in first) {
    const metricKey = keys.find((k) => !k.startsWith("_") && typeof first[k] === "number") ?? keys[0];
    const labelKey = keys.find((k) => typeof first[k] === "string" && !k.startsWith("_")) ?? keys[0];
    const mean = first._mean;
    const top = result[0];
    return `Found ${result.length} anomal${result.length === 1 ? "y" : "ies"} (column mean: ${formatNumber(mean)}). The most significant: ${top[labelKey] ?? "a data point"} deviates ${formatPercent(top._deviationPct)} from average (value: ${formatNumber(top[metricKey])}).`;
  }

  /* ── summarize: rows with type + mean ── */
  if ("type" in first && "mean" in first) {
    const lines = result.slice(0, 4).map((s) => {
      if (s.error) return `${s.column}: not found`;
      if (s.type === "categorical") return `${s.column}: most common is "${s.topValue}"`;
      const arrow = s.trendPct !== null ? (s.trendPct >= 0 ? " ↑" : " ↓") : "";
      return `${s.column}: avg ${formatNumber(s.mean)}${s.latest !== null ? `, latest ${formatNumber(s.latest)}${arrow}` : ""}`;
    });
    return lines.join(" | ");
  }

  /* ── correlation: rows with coefficient ── */
  if ("coefficient" in first) {
    return `${first.col1} and ${first.col2} have a ${first.interpretation} (r = ${first.coefficient}).`;
  }

  /* ── computeMetric / topN / aggregate / generic ranked list ── */
  if (result.length > 0) {
    const metricKey = keys.find((k) => typeof first[k] === "number" && !k.startsWith("_")) ?? keys[keys.length - 1];
    const labelKey = keys.find((k) => typeof first[k] === "string" && !k.startsWith("_")) ?? keys[0];
    const top = result[0];
    const mid = result[1];
    const last = result[result.length - 1];

    const topLabel = top[labelKey] !== undefined ? String(top[labelKey]) : "Top entry";
    const midLabel = mid?.[labelKey] !== undefined ? String(mid[labelKey]) : null;
    const lastLabel = last[labelKey] !== undefined ? String(last[labelKey]) : null;

    let narrative = `${topLabel} leads with ${formatNumber(top[metricKey])}`;
    if (midLabel) narrative += `, followed by ${midLabel} (${formatNumber(mid[metricKey])})`;
    if (result.length > 2 && lastLabel && lastLabel !== topLabel) {
      narrative += `. ${lastLabel} is at the bottom with ${formatNumber(last[metricKey])}`;
    }
    narrative += ".";
    return narrative;
  }

  return method ? `Analysis complete — ${method.toLowerCase()}.` : "Analysis complete.";
}
