/**
 * queryService — Central Query Orchestrator (server-side).
 *
 * Coordinates: LLM parse → access control → analysis ops → LLM narrative
 * to turn a natural-language question into a fully structured response.
 *
 * Request-scoped registry: each call to processQuery loads only the datasets
 * visible to the authenticated user (built-ins + their own uploads). A small
 * shim exposes the same `getRegistry`/`getDataset`/`findDatasetByName`/
 * `getDatasetSummary` API the original client engine relied on.
 */

import { Dataset } from "../models/Dataset.js";
import { datasetService } from "./datasetService.js";
import { llmService } from "./llmService.js";
import { groqChat, isGroqConfigured } from "./groqService.js";
import { getRoleRestrictions, isOwner } from "../config/permissions.js";
import { AccessRequest } from "../models/AccessRequest.js";

import {
  aggregate,
  filter,
  sort,
  topN,
  trend,
  compare,
  breakdown,
  anomaly,
  correlation,
  computeMetric,
  joinDatasets,
  summarize,
  rankColumns,
  searchText,
  extractThemes,
  sentimentScan,
  formatNumber,
  formatPercent,
  parseDateColumn,
} from "./analysisOps.js";

import {
  stripMarkdownFences,
  normalizePlan,
  coerceSentimentPlan,
  fallbackParseQuery,
  fallbackNarrative,
} from "./queryFallbacks.js";

import { DATA_DICTIONARY } from "../config/dataDictionary.js";

/* ═══════════════════════════════════════════════════════════
   REQUEST-SCOPED HELPERS  (replaces module-level dataRegistry + accessControl)
═══════════════════════════════════════════════════════════ */

/**
 * Load the datasets visible to this user/request.
 * - Company tab: all company-source datasets
 * - Upload tab + datasetId: just that one user-owned dataset (after RBAC check)
 *
 * Returns objects shaped like the legacy registry entries:
 * { id, name, description, source, type, rowCount, columns, data }
 */
async function loadRequestRegistry(user, activeTab, datasetId) {
  if (activeTab === "upload" && datasetId) {
    const doc = await Dataset.findById(datasetId);
    if (!doc) return [];
    if (doc.source === "user" && doc.ownerId?.toString() !== user._id.toString()) return [];
    return [_docToEntry(doc)];
  }
  const docs = await Dataset.find({ source: "company" });
  return docs.map(_docToEntry);
}

function _docToEntry(doc) {
  return {
    id:          doc._id.toString(),
    name:        doc.name,
    description: doc.description,
    source:      doc.source,
    type:        doc.type,
    rowCount:    doc.rowCount,
    columns:     doc.columns,
    data:        doc.rows,
  };
}

/**
 * Server-side access check for column-level RBAC. Combines the role baseline
 * with any per-user approved access requests.
 */
async function checkAccessForUser(user, requiredColumns) {
  if (isOwner(user.role)) return { allowed: true, blockedColumns: [] };

  const baseline = getRoleRestrictions(user.role);
  if (baseline.length === 0) return { allowed: true, blockedColumns: [] };

  const approved = await AccessRequest.find({
    userId: user._id,
    status: "approved",
  }).select("columns");

  const grantedSet = new Set();
  for (const req of approved) {
    for (const col of req.columns) grantedSet.add(col.toLowerCase());
  }

  const restrictedSet = new Set(
    baseline.filter(({ col }) => !grantedSet.has(col.toLowerCase())).map((r) => r.col.toLowerCase())
  );
  const reasonByCol = new Map(baseline.map((r) => [r.col.toLowerCase(), r.reason]));

  const blocked = [];
  for (const col of requiredColumns ?? []) {
    if (restrictedSet.has(String(col).toLowerCase())) {
      blocked.push({ col, reason: reasonByCol.get(String(col).toLowerCase()) ?? "Restricted" });
    }
  }
  return { allowed: blocked.length === 0, blockedColumns: blocked };
}

async function getRestrictionsForUser(user) {
  if (isOwner(user.role)) return [];
  const baseline = getRoleRestrictions(user.role);
  if (baseline.length === 0) return [];
  const approved = await AccessRequest.find({
    userId: user._id,
    status: "approved",
  }).select("columns");
  const grantedSet = new Set();
  for (const req of approved) for (const c of req.columns) grantedSet.add(c.toLowerCase());
  return baseline.filter(({ col }) => !grantedSet.has(col.toLowerCase()));
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */

/**
 * Recursively walk a computeMetric formula object and collect every leaf
 * that is a plain string (column name) into the provided Set.
 *
 * Handles any depth of nesting via left/right (arithmetic) or
 * numerator/denominator (ratio/divide) branches.
 *
 * @param {string|object} formula
 * @param {Set<string>}   set  — column names accumulate here
 */
function extractFormulaColumns(formula, set) {
  if (!formula) return;
  if (typeof formula === "string") {
    set.add(formula);
    return;
  }
  if (typeof formula !== "object") return;
  extractFormulaColumns(formula.left,        set);
  extractFormulaColumns(formula.right,       set);
  extractFormulaColumns(formula.numerator,   set);
  extractFormulaColumns(formula.denominator, set);
}

async function callGroqForUnstructured(prompt) {
  if (!isGroqConfigured()) throw new Error("Groq API key is missing.");
  const text = await groqChat({ user: prompt });
  return text.trim();
}

const RAG_TOP_K = 10;

/**
 * RAG-backed handler for unstructured datasets.
 *
 * 1. Embed the question
 * 2. Retrieve the top-K most similar chunks (rows) from this dataset only
 * 3. Build a grounded prompt with just those chunks + the question
 * 4. Call the LLM
 *
 * The trust panel now reports "retrieved X of Y rows", which is much more
 * honest than the previous "we sent the LLM the whole file" pattern.
 */
async function handleUnstructuredQuery(question, dataset) {
  try {
    const { retrieve } = await import("./retrievalService.js");
    const { chunks, totalScanned, queryEmbedMs, backend } = await retrieve(
      { datasetId: dataset.id ?? dataset._id },
      question,
      RAG_TOP_K
    );

    if (totalScanned === 0) {
      return {
        type: "error",
        message: "This dataset has no embedded chunks yet. Try re-uploading the file.",
      };
    }

    const context = chunks
      .map((c) => `[Row ${c.rowIndex + 1}] ${c.text}`)
      .join("\n");

    const prompt = `You are a data analyst.
A retrieval system has selected the most relevant rows from the user's dataset.

User Question:
${question}

Relevant rows (top ${chunks.length} of ${totalScanned}):
${context}

Answer ONLY based on the rows above. Cite row numbers when useful.
Do not assume anything not present in the data. If the rows do not contain enough information, say so.`;

    const answer = await callGroqForUnstructured(prompt);

    return {
      type: "text",
      answer,
      source: `Unstructured Dataset (RAG retrieved ${chunks.length}/${totalScanned} rows via ${backend})`,
      datasetName: dataset.name,
      rowCount: totalScanned,
      retrieved: chunks.map((c) => ({ rowIndex: c.rowIndex, text: c.text, score: +c.score.toFixed(4) })),
      queryEmbedMs,
      retrievalBackend: backend,
    };
  } catch (err) {
    return {
      type: "error",
      message: `Unexpected error: ${err?.message ?? String(err)}`,
    };
  }
}

function formatForChart(result, chartType, intent) {
  if (
    result &&
    !Array.isArray(result) &&
    !result.counts &&
    !result.groups &&
    Object.entries(result).every(([, value]) => Array.isArray(value) || (value && typeof value === "object"))
  ) {
    return Object.entries(result).flatMap(([label, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        const metricKey = Object.keys(first ?? {}).find((k) => typeof first[k] === "number" && !k.startsWith("_"));
        const nameKey = Object.keys(first ?? {}).find((k) => typeof first[k] === "string" && !k.startsWith("_"));
        if (metricKey) {
          return [{
            name: label,
            value: Number(first[metricKey]),
            label: nameKey ? String(first[nameKey]) : label,
          }];
        }
      }
      return [];
    });
  }

  // ── sentimentScan special handling ──
  if (result && result.counts && result.groups !== undefined) {
    // If we have groupRanking (temporal/dimensional breakdown), use it for bar chart
    if (result.groupRanking && result.groupRanking.length > 0) {
      const ranking = result.groupRanking;
      // Always show as bar chart when we have grouped temporal/dimensional data
      return ranking.map((g) => ({
        name: String(g.group),
        "Negative %": g.negativeRate,
        "Positive %": g.positiveRate,
        Total: g.total,
      }));
    }
    // No groupRanking: fall back to counts pie chart
    const c = result.counts;
    return [
      { name: "Positive", value: c.positive ?? 0 },
      { name: "Negative", value: c.negative ?? 0 },
      { name: "Neutral",  value: c.neutral  ?? 0 },
    ].filter((d) => d.value > 0);
  }

  let dataArr = result;
  if (!Array.isArray(result)) {
    if (result?.topKeywords)  dataArr = result.topKeywords;
    else                      dataArr = [];
  }

  if (!dataArr || !Array.isArray(dataArr) || dataArr.length === 0) return [];

  switch (chartType) {
    case "pie": {
      const total = dataArr.reduce((sum, r) => {
        const numericKey = Object.keys(r).find(
          (k) => typeof r[k] === "number" && k !== "share" && !k.startsWith("_")
        );
        return sum + (numericKey ? Number(r[numericKey]) : 0);
      }, 0);
      return dataArr.map((r) => {
        const keys    = Object.keys(r);
        const nameCol = keys.find((k) => typeof r[k] === "string" && !k.startsWith("_")) || keys[0];
        const valCol  = keys.find(
          (k) => typeof r[k] === "number" && !k.startsWith("_") && k !== "share"
        ) || keys.find((k) => typeof r[k] === "number");
        const val = valCol ? Number(r[valCol]) : 0;
        const percentage =
          r.share !== undefined ? r.share : total > 0 ? (val / total) * 100 : 0;
        return {
          name: String(r[nameCol] ?? "Unknown"),
          value: val,
          percentage: +Number(percentage).toFixed(2),
        };
      });
    }

    case "bar": {
      return dataArr.map((r) => {
        const keys    = Object.keys(r);
        const nameCol = keys.find((k) => typeof r[k] === "string" && !k.startsWith("_")) || keys[0];
        let   val     = 0;
        const valCol  = keys.find((k) => typeof r[k] === "number" && !k.startsWith("_"));
        if (valCol) {
          val = Number(r[valCol]);
        } else {
          const nestedMetrics = keys.find(
            (k) => typeof r[k] === "object" && r[k] !== null && r[k].total !== undefined
          );
          if (nestedMetrics) val = r[nestedMetrics].total;
        }
        return { name: String(r[nameCol] ?? "Unknown"), value: val };
      });
    }

    case "line": {
      const mapped = dataArr.map((r) => {
        const keys    = Object.keys(r);
        const nameCol = keys.find((k) => typeof r[k] === "string" && !k.startsWith("_")) || keys[0];
        const valCol  = keys.find((k) => typeof r[k] === "number" && !k.startsWith("_"));
        return { name: String(r[nameCol] ?? "Unknown"), value: valCol ? Number(r[valCol]) : 0 };
      });
      const sortedNames = parseDateColumn(mapped.map((m) => m.name));
      return sortedNames.map((name) => mapped.find((m) => m.name === name)).filter(Boolean);
    }

    case "table":
      return Array.isArray(result) ? result : [];

    case "none":
      return [];

    default:
      return Array.isArray(result) ? result : [];
  }
}

function getMetricDefinitions(columns) {
  const lowerCols = columns.map(c => c.toLowerCase());
  return DATA_DICTIONARY.filter(d => lowerCols.includes(d.name.toLowerCase()));
}

function isSentimentQuestion(question = "") {
  return /\bhappy\b|\bhappiness\b|\bsatisfied?\b|\bsatisfaction\b|\bfeel(?:ing|ings)?\b|\bfeedback\b|\bcomplaints?\b|\breviews?\b|\bunhappy\b|\bdissatisfied\b|\bsentiment\b/i.test(question);
}

function findFeedbackDatasetSummary(datasets = []) {
  return datasets.find((ds) =>
    ds?.id === "customer_feedback" ||
    ds?.name?.toLowerCase().includes("customer feedback") ||
    ds?.name?.toLowerCase().includes("feedback")
  ) ?? null;
}

function normalizeAnalysisTypes(analysis = [], intent = "summary", question = "") {
  const normalized = []
    .concat(analysis ?? [])
    .concat(!analysis?.length && intent ? [intent] : [])
    .map((value) => String(value).toLowerCase().trim())
    .flatMap((value) => {
      if (!value) return [];
      if (["highest", "top", "best", "most", "maximum", "max"].includes(value)) return ["max"];
      if (["lowest", "bottom", "worst", "least", "minimum", "min"].includes(value)) return ["min"];
      if (value === "ranking") return /\b(lowest|bottom|worst|least|min|minimum)\b/i.test(question) ? ["min"] : ["max"];
      return [value];
    });

  return [...new Set(normalized)];
}

function normalizePlannerPlan(plan, question = "") {
  if (!plan) return null;

  const dataset = typeof plan.dataset === "string" && plan.dataset
    ? plan.dataset
    : (Array.isArray(plan.datasets) ? plan.datasets[0] : "");
  const metrics = Array.isArray(plan.metrics)
    ? plan.metrics.filter((value) => typeof value === "string" && value)
    : (Array.isArray(plan.columns) ? plan.columns.filter((value) => typeof value === "string" && value) : []);
  const dimensions = Array.isArray(plan.dimensions)
    ? plan.dimensions.filter((value) => typeof value === "string" && value)
    : [];
  const analysis = normalizeAnalysisTypes(plan.analysis, plan.intent, question);

  return {
    ...plan,
    dataset,
    datasets: dataset ? [dataset] : (Array.isArray(plan.datasets) ? plan.datasets : []),
    metrics,
    dimensions,
    analysis: analysis.length > 0 ? analysis : ["summary"],
    columns: [...new Set([...metrics, ...dimensions])],
  };
}

function fuzzyMatchColumnName(name, knownCols) {
  if (!name) return name;
  const lower = name.toLowerCase();
  const knownColsLower = new Set(knownCols.map((c) => c.toLowerCase()));
  if (knownColsLower.has(lower)) {
    return knownCols.find((c) => c.toLowerCase() === lower) ?? name;
  }

  const bySubstring = knownCols.find(
    (k) => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())
  );
  if (bySubstring) return bySubstring;

  const tokens = lower.split(/[_\s]+/).filter(Boolean);
  let bestScore = 0;
  let bestCol = null;
  for (const k of knownCols) {
    const kTokens = k.toLowerCase().split(/[_\s]+/);
    const score = tokens.filter((t) => kTokens.some((kt) => kt.includes(t) || t.includes(kt))).length;
    if (score > bestScore) {
      bestScore = score;
      bestCol = k;
    }
  }
  return bestScore > 0 ? bestCol : null;
}

function repairPlannerColumns(plan, targetSummary) {
  if (!plan || !targetSummary) return { plan, unfixableCount: 0 };
  const knownCols = (targetSummary.columns ?? []).map((c) => c.name);
  const fixedPlan = { ...plan };
  let unfixableCount = 0;

  for (const key of ["metrics", "dimensions"]) {
    const values = Array.isArray(fixedPlan[key]) ? fixedPlan[key] : [];
    fixedPlan[key] = values
      .map((value) => {
        const fixed = fuzzyMatchColumnName(value, knownCols);
        if (!fixed) unfixableCount++;
        return fixed;
      })
      .filter(Boolean);
  }

  fixedPlan.columns = [...new Set([...(fixedPlan.metrics ?? []), ...(fixedPlan.dimensions ?? [])])];
  return { plan: fixedPlan, unfixableCount };
}

function combineMetadata(base, next) {
  if (!next) return base;
  return {
    columnsUsed: [...new Set([...(base.columnsUsed || []), ...(next.columnsUsed || [])])].filter(Boolean),
    rowsAnalyzed: Math.max(base.rowsAnalyzed || 0, next.rowsAnalyzed || 0),
    method: base.method ? `${base.method} | ${next.method}` : (next.method || ""),
    filters: base.filters && next.filters ? `${base.filters} AND ${next.filters}` : (base.filters || next.filters || null),
    analysisKeys: [...new Set([...(base.analysisKeys || []), ...(next.analysisKeys || [])])],
  };
}

function buildExecutionSteps(plan, dataset) {
  const columns = dataset?.columns ?? [];
  const numericCols = columns.filter((c) => c.type === "numeric").map((c) => c.name);
  const textCols = columns.filter((c) => c.type === "text").map((c) => c.name);
  const categoricalCols = columns.filter((c) => c.type === "categorical").map((c) => c.name);
  const dateCols = columns.filter((c) => c.type === "date").map((c) => c.name);
  const metrics = (plan.metrics ?? []).filter((c) => numericCols.includes(c) || textCols.includes(c) || categoricalCols.includes(c));
  const dimensions = (plan.dimensions ?? []).filter((c) => categoricalCols.includes(c) || dateCols.includes(c));
  const primaryMetric = metrics.find((c) => numericCols.includes(c)) ?? metrics[0] ?? numericCols[0] ?? textCols[0] ?? null;
  const primaryDimension = dimensions[0] ?? categoricalCols[0] ?? dateCols[0] ?? null;
  const timeCol = dimensions.find((c) => dateCols.includes(c)) ?? dateCols[0] ?? null;
  const textCol = metrics.find((c) => textCols.includes(c)) ?? textCols[0] ?? null;
  const analyses = normalizeAnalysisTypes(plan.analysis, plan.intent);
  const steps = [];

  for (const analysis of analyses) {
    switch (analysis) {
      case "max":
        if (primaryMetric) steps.push({ key: "max", type: "topN", metricCol: primaryMetric, groupCol: primaryDimension, direction: "top", n: 1 });
        break;
      case "min":
        if (primaryMetric) steps.push({ key: "min", type: "topN", metricCol: primaryMetric, groupCol: primaryDimension, direction: "bottom", n: 1 });
        break;
      case "trend":
        if (primaryMetric && (timeCol || primaryDimension)) steps.push({ key: "trend", type: "trend", metricCol: primaryMetric, timeCol: timeCol ?? primaryDimension, groupCol: dimensions.find((c) => c !== (timeCol ?? primaryDimension)) ?? null });
        break;
      case "comparison":
        if (primaryDimension && metrics.length > 0) steps.push({ key: "comparison", type: "compare", groupCol: primaryDimension, metricCols: metrics.filter((c) => numericCols.includes(c)) });
        break;
      case "sentiment":
        if (textCol) steps.push({ key: "sentiment", type: "sentimentScan", textCol, groupCol: primaryDimension });
        break;
      case "breakdown":
        if (primaryMetric && primaryDimension) steps.push({ key: "breakdown", type: "breakdown", metricCol: primaryMetric, groupCol: primaryDimension });
        break;
      case "anomaly":
        if (primaryMetric) steps.push({ key: "anomaly", type: "anomaly", metricCol: primaryMetric, threshold: 20 });
        break;
      case "correlation": {
        const numericMetrics = metrics.filter((c) => numericCols.includes(c));
        if (numericMetrics.length >= 2) steps.push({ key: "correlation", type: "correlation", col1: numericMetrics[0], col2: numericMetrics[1] });
        break;
      }
      case "computed_metric":
        if (numericCols.length >= 2) steps.push({ key: "computed_metric", type: "computeMetric", formula: { operation: "subtract", left: numericCols[0], right: numericCols[1] }, resultName: "Computed Metric", groupCol: primaryDimension });
        break;
      case "text_search":
        if (textCol) steps.push({ key: "text_search", type: "searchText", textCol, query: "" });
        break;
      case "summary":
      default:
        if (metrics.length > 0 || numericCols.length > 0) {
          steps.push({ key: "summary", type: "summarize", columns: metrics.filter((c) => numericCols.includes(c)).length > 0 ? metrics.filter((c) => numericCols.includes(c)) : numericCols.slice(0, 6) });
        }
        break;
    }
  }

  return steps;
}

function executeStep(step, data) {
  const baseMeta = { columnsUsed: [], rowsAnalyzed: 0, method: "", filters: null, analysisKeys: [step.key] };

  switch (step.type) {
    case "topN": {
      if (step.groupCol) {
        const aggregated = aggregate(data, step.metricCol, step.groupCol, "sum");
        if (!aggregated?.result) return aggregated;
        const ranked = topN(aggregated.result, step.metricCol, step.n, step.direction);
        return {
          result: ranked.result,
          metadata: combineMetadata(combineMetadata(baseMeta, aggregated.metadata), ranked.metadata),
        };
      }
      const ranked = topN(data, step.metricCol, step.n, step.direction);
      return {
        ...ranked,
        metadata: combineMetadata(baseMeta, ranked.metadata),
      };
    }
    case "trend": {
      const result = trend(data, step.timeCol, step.metricCol, step.groupCol ?? null);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "compare": {
      const result = compare(data, step.groupCol, step.metricCols);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "breakdown": {
      const result = breakdown(data, step.metricCol, step.groupCol);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "anomaly": {
      const result = anomaly(data, step.metricCol, step.threshold);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "correlation": {
      const result = correlation(data, step.col1, step.col2);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "computeMetric": {
      const result = computeMetric(data, step.formula, step.resultName, step.groupCol);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "searchText": {
      const result = searchText(data, step.textCol, step.query);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "sentimentScan": {
      const result = sentimentScan(data, step.textCol, step.groupCol ?? null);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
    case "summarize":
    default: {
      const result = summarize(data, step.columns);
      return { ...result, metadata: combineMetadata(baseMeta, result.metadata) };
    }
  }
}

function repairSentimentPlan(plan, question, availableDatasets) {
  if (!plan) return plan;

  const feedbackDataset = findFeedbackDatasetSummary(availableDatasets);
  const datasetColumns = feedbackDataset?.columns ?? [];
  const textCol = datasetColumns.find((c) => c.type === "text")?.name ?? "text";
  const groupCol =
    datasetColumns.find((c) => c.name.toLowerCase() === "region")?.name ??
    datasetColumns.find((c) => c.type === "categorical")?.name ??
    datasetColumns.find((c) => c.type === "date")?.name ??
    null;
  const datasetLooksLikeFeedback = (plan.datasets ?? []).some((ds) =>
    String(ds).toLowerCase().includes("feedback") || String(ds).toLowerCase() === "customer_feedback"
  );
  const shouldForceSentiment =
    isSentimentQuestion(question) ||
    plan.intent === "sentiment" ||
    datasetLooksLikeFeedback;

  if (!shouldForceSentiment) return plan;

  const safeColumns = [textCol, groupCol].filter(Boolean);

  return {
    ...plan,
    intent: "sentiment",
    dataset: feedbackDataset?.id ?? plan.dataset ?? "",
    datasets: feedbackDataset ? [feedbackDataset.id] : (plan.datasets ?? []),
    metrics: [textCol],
    dimensions: groupCol ? [groupCol] : [],
    analysis: ["sentiment"],
    columns: safeColumns,
    operations: [],
    chartType: "pie",
    title: plan.title || "Sentiment Analysis",
  };
}

/* ═══════════════════════════════════════════════════════════
   MAIN EXPORT
═══════════════════════════════════════════════════════════ */

/**
 * Process a natural-language question end-to-end.
 *
 * @param {string}      question          — Raw user question
 * @param {string}      role              — Current user role (e.g. "Owner", "Finance Team")
 * @param {object[]}    conversationContext — Last N messages [{ role, content }]
 * @param {string}      activeTab         — "company" | "upload"
 * @param {string|null} uploadedDatasetId — Registry id of the uploaded dataset (if any)
 * @returns {Promise<object>}             — Structured response for the UI
 */
export async function processQuery({
  user,
  question,
  context: conversationContext = [],
  activeTab,
  datasetId: uploadedDatasetId,
}) {
  try {
    const role = user.role;
    /* ── Load request-scoped registry (replaces module-level _registry) ── */
    const registry = await loadRequestRegistry(user, activeTab, uploadedDatasetId);
    const _registryById = new Map(registry.map((d) => [d.id, d]));
    const getRegistry = () => registry;
    const getDataset = (id) => _registryById.get(id);
    const findDatasetByName = (name) => {
      const needle = String(name ?? "").toLowerCase();
      if (!needle) return undefined;
      return registry.find((d) => d.name.toLowerCase().includes(needle));
    };
    const getDatasetSummary = (id) => {
      const d = _registryById.get(id);
      if (!d) return undefined;
      const { data: _data, ...rest } = d; void _data;
      return rest;
    };

    // Inline LLM helpers (replace old client geminiApi exports)
    const parseQuery = async (q, registryMeta, ctx = []) => {
      try {
        const { raw } = await llmService.parse({ question: q, registry: registryMeta, context: ctx });
        return normalizePlan(coerceSentimentPlan(JSON.parse(stripMarkdownFences(raw)), q, registryMeta), q);
      } catch (err) {
        console.warn("[queryService] LLM parse failed, falling back:", err.message);
        return fallbackParseQuery(q, registryMeta);
      }
    };
    const generateNarrative = async (analysisResults, q) => {
      try {
        const { text } = await llmService.narrative({
          question: q,
          result: analysisResults.result,
          metadata: analysisResults.metadata ?? {},
        });
        return text;
      } catch (err) {
        console.warn("[queryService] LLM narrative failed, falling back:", err.message);
        return fallbackNarrative(analysisResults, q);
      }
    };
    const isApiAvailable = () => isGroqConfigured();

    /* ── Step 1: Build available datasets ── */
    let availableDatasets;

    if (activeTab === "upload" && uploadedDatasetId) {
      const summary = getDatasetSummary(uploadedDatasetId);
      availableDatasets = summary ? [summary] : [];
    } else {
      availableDatasets = getRegistry()
        .filter((ds) => ds.source === "company")
        .map((ds) => getDatasetSummary(ds.id))
        .filter(Boolean);
    }

    if (availableDatasets.length === 0) {
      return {
        type: "error",
        message:
          activeTab === "upload"
            ? "No uploaded dataset found. Please upload a CSV or Excel file first."
            : "No datasets available. Please upload a file or switch to Company Data.",
      };
    }

    /* ── Step 2: Parse the question into an analysis plan ── */
    let analysisPlan;
    try {
      analysisPlan = normalizePlannerPlan(
        repairSentimentPlan(await parseQuery(question, availableDatasets, conversationContext), question, availableDatasets),
        question
      );
    } catch {
      try {
        analysisPlan = normalizePlannerPlan(
          repairSentimentPlan(fallbackParseQuery(question, availableDatasets), question, availableDatasets),
          question
        );
      } catch (fallbackErr) {
        console.error("[queryEngine] Both API and local parser failed:", fallbackErr.message);
        analysisPlan = null;
      }
    }

    // Validate the plan has enough to work with
    if (
      !analysisPlan ||
      !analysisPlan.dataset
    ) {
      return {
        type: "error",
        message:
          "I couldn't understand that question. Try something like 'Show me revenue by region'.",
      };
    }

    const plan = analysisPlan; // alias used by downstream steps

    /* ── Step 3: Resolve datasets ── */
    const resolvedDatasets = [];

    for (const dsName of plan.datasets) {
      // Pass 1 — exact / substring name match in registry
      let found = findDatasetByName(dsName) ?? getDataset(dsName);

      if (!found) {
        // Pass 2 — partial word match: tokenise the plan name and score candidates
        const tokens = dsName.toLowerCase().split(/\s+/);

        // Candidate pool: uploaded dataset first (if we're in upload mode), then full registry
        const candidates = [
          ...(activeTab === "upload" && uploadedDatasetId
            ? [getDataset(uploadedDatasetId)].filter(Boolean)
            : []),
          ...getRegistry(),
        ];

        let bestScore = 0;
        for (const ds of candidates) {
          const haystack = (ds.name + " " + ds.description).toLowerCase();
          const score    = tokens.filter((t) => haystack.includes(t)).length;
          if (score > bestScore) { bestScore = score; found = ds; }
        }
      }

      // Deduplicate by id
      if (found && !resolvedDatasets.some((d) => d.id === found.id)) {
        resolvedDatasets.push(found);
      }
    }

    // Final fallback: if the plan listed no usable dataset names but we have
    // availableDatasets, pick the first one so simple questions ("summarize data")
    // still work without Gemini needing to name a dataset explicitly.
    if (resolvedDatasets.length === 0 && availableDatasets.length > 0) {
      const fallbackDs = getDataset(availableDatasets[0].id);
      if (fallbackDs) resolvedDatasets.push(fallbackDs);
    }

    if (resolvedDatasets.length === 0) {
      return {
        type: "error",
        message: "I couldn't find a matching dataset for your question.",
      };
    }

    // Primary dataset drives the operation pipeline; extras are available for joins
    const targetDataset = resolvedDatasets[0];

    if (targetDataset?.type === "unstructured") {
      return await handleUnstructuredQuery(question, targetDataset);
    }

    const repaired = repairPlannerColumns(plan, availableDatasets.find((ds) => ds.id === targetDataset.id) ?? availableDatasets[0]);
    analysisPlan = {
      ...analysisPlan,
      ...repaired.plan,
      dataset: targetDataset.id,
      datasets: [targetDataset.id],
    };
    const planWithDataset = analysisPlan;
    const executionSteps = buildExecutionSteps(planWithDataset, targetDataset);

    if (repaired.unfixableCount > 0 || executionSteps.length === 0) {
      try {
        const fallbackPlan = normalizePlannerPlan(
          repairSentimentPlan(fallbackParseQuery(question, availableDatasets), question, availableDatasets),
          question
        );
        const fallbackRepaired = repairPlannerColumns(fallbackPlan, availableDatasets.find((ds) => ds.id === targetDataset.id) ?? availableDatasets[0]);
        analysisPlan = {
          ...fallbackPlan,
          ...fallbackRepaired.plan,
          dataset: targetDataset.id,
          datasets: [targetDataset.id],
        };
      } catch {
        analysisPlan = planWithDataset;
      }
    }

    const finalPlan = analysisPlan;
    const finalSteps = buildExecutionSteps(finalPlan, targetDataset);

    if (finalSteps.length === 0) {
      return {
        type: "error",
        message: "I couldn't build a valid analysis plan for that question.",
      };
    }

    /* ── Step 4: Collect all required columns ── */
    const allRequiredColumns = new Set([
      ...(finalPlan.metrics ?? []),
      ...(finalPlan.dimensions ?? []),
      ...(finalPlan.columns ?? []),
    ]);

    for (const step of finalSteps) {
      for (const key of ["metricCol", "groupCol", "timeCol", "column", "col1", "col2", "textCol"]) {
        if (typeof step[key] === "string" && step[key]) allRequiredColumns.add(step[key]);
      }
      for (const arr of [step.metricCols, step.columns].filter(Array.isArray)) {
        for (const c of arr) if (typeof c === "string" && c) allRequiredColumns.add(c);
      }
      if (step.formula) extractFormulaColumns(step.formula, allRequiredColumns);
    }

    /* ── Step 5: Access control — MUST run before any data processing ── */
    const accessResult = await checkAccessForUser(user, Array.from(allRequiredColumns));

    if (!accessResult.allowed) {
      return {
        type: "blocked",
        blockedColumns: accessResult.blockedColumns,
        role,
        restrictions: await getRestrictionsForUser(user),
      };
    }

    /* ── Step 6: Execute the operations ── */
    let data = resolvedDatasets[0].data;
    let analysisResult = null;
    const combinedResults = {};

    let allMetadata = {
      columnsUsed: [],
      rowsAnalyzed: 0,
      method: "",
      filters: null,
      analysisKeys: [],
    };

    const executionLog = [];

    for (const step of finalSteps) {
      try {
        const opResult = executeStep(step, data);

        if (opResult) {
          analysisResult = opResult;
          combinedResults[step.key] = opResult.result;
          executionLog.push({ op: step.key, ...opResult });
          if (opResult.metadata) {
            allMetadata = combineMetadata(allMetadata, opResult.metadata);
          }
        }
      } catch (err) {
        console.error("Operation failed:", step.key, err);
        executionLog.push({ op: step.key, error: String(err) });
      }
    }

    if (!analysisResult) {
      return { type: "error", message: "No valid operations could be executed for this question." };
    }
    analysisResult = finalSteps.length === 1
      ? analysisResult
      : { result: combinedResults, metadata: allMetadata };

    /* ── Step 7: Generate narrative ── */
    const activePlan = finalPlan;
    let narrative = "";
    const metricDefs = getMetricDefinitions(allMetadata.columnsUsed);
    try {
      narrative = await generateNarrative(analysisResult, question, metricDefs);
    } catch {
      narrative = fallbackNarrative(analysisResult, question);
    }
    if (!narrative) narrative = fallbackNarrative(analysisResult, question);

    const aiPowered = isApiAvailable();

    /* ── Step 9: Final return ── */
    // Override chartType for sentiment+groupRanking to bar (plan might say "pie")
    const hasGroupRanking = analysisResult.result?.groupRanking?.length > 0;
    const effectiveChartType = hasGroupRanking
      ? "bar"
      : ((allMetadata.analysisKeys?.length ?? 0) > 1 ? "bar" : (activePlan.chartType || "bar"));

    const chartData = formatForChart(analysisResult.result, effectiveChartType, activePlan.intent);

    return {
      type: "success",
      narrative,
      chartData,
      chartType: effectiveChartType,
      title: activePlan.title || `${activePlan.intent} analysis`,
      trust: {
        intent: activePlan.intent,
        datasetsUsed: resolvedDatasets.map(d => d.name),
        columnsUsed: allMetadata.columnsUsed,
        rowsAnalyzed: allMetadata.rowsAnalyzed,
        method: allMetadata.method,
        source: activeTab === "company"
          ? `Company Database → ${resolvedDatasets.map(d => d.name).join(", ")}`
          : `Uploaded File → ${resolvedDatasets[0]?.name}`,
        aiPowered
      },
      rawResult: analysisResult.result
    };
  } catch (err) {
    return {
      type: "error",
      message: `Unexpected error: ${err?.message ?? String(err)}`,
    };
  }
}

/* ═══════════════════════════════════════════════════════════
   EXTRA EXPORTS
═══════════════════════════════════════════════════════════ */

export async function getSuggestedQuestions(activeTab, uploadedDatasetId, role = "Owner") {
  if (activeTab === "company") {
    // Role-specific suggestions — avoid suggesting columns that are restricted
    const isMarketing = role === "Marketing Team";
    const isHR        = role === "HR Team";
    const isFinance   = role === "Finance Team";

    const salesQs = [
      "What is the revenue by region?",
      "How did revenue trend month over month?",
      "Which channel generates the most revenue?",
      "What is the breakdown of units sold by product?",
    ];

    const customerQs = [
      "How is churn trending by week?",
      "Show signups vs churn over time",
      "Which week had the highest active users?",
      isFinance ? null : "How did NPS change over time?",
      "Which channel has the most signups?",
    ].filter(Boolean);

    const costQs = isHR
      ? [
          "Which department has the highest headcount?",
          "Show headcount breakdown by department",
        ]
      : isMarketing
      ? [
          "Which department has the highest headcount?",
        ]
      : [
          "Which department had the highest spend in Q1?",
          "Compare Q1, Q2, Q3, Q4 spending across departments",
          "Which department has the highest headcount?",
          "Show the spending breakdown by category",
        ];

    const feedbackQs = (isFinance || isHR)
      ? ["Which month had the worst customer feedback?"]
      : [
          "Which month had the worst customer feedback?",
          "What are the main complaints in customer feedback?",
        ];

    return [...salesQs.slice(0, 1), ...customerQs.slice(0, 1), ...costQs.slice(0, 1), ...feedbackQs.slice(0, 1)];
  }

  if (activeTab === "upload" && uploadedDatasetId) {
    const doc = await Dataset.findById(uploadedDatasetId).select("columns");
    if (!doc) return [];

    const numericCols = doc.columns.filter((c) => c.type === "numeric");
    const catCols     = doc.columns.filter((c) => c.type === "categorical");
    const textCols    = doc.columns.filter((c) => c.type === "text");
    const dateCols    = doc.columns.filter((c) => c.type === "date");

    const suggested = [];
    if (numericCols.length > 0 && catCols.length > 0) {
      suggested.push(`What is the total ${numericCols[0].name} by ${catCols[0].name}?`);
      suggested.push(`Show top 5 ${catCols[0].name} by ${numericCols[0].name}`);
    }
    if (dateCols.length > 0 && numericCols.length > 0) {
      suggested.push(`How did ${numericCols[0].name} trend over time?`);
    }
    if (numericCols.length > 1) {
      suggested.push(`Compare ${numericCols[0].name} and ${numericCols[1].name}`);
    }
    if (textCols.length > 0) {
      suggested.push(`What are the main themes in ${textCols[0].name}?`);
    }
    if (numericCols.length > 0) {
      suggested.push(`What is the average ${numericCols[0].name}?`);
    }
    return suggested.slice(0, 5);
  }

  return [];
}

export async function getDataDictionary(activeTab, uploadedDatasetId) {
  const predefined = DATA_DICTIONARY;

  if (activeTab === "company") return predefined;

  if (activeTab === "upload" && uploadedDatasetId) {
    const doc = await Dataset.findById(uploadedDatasetId).select("columns");
    if (!doc) return predefined;

    const autoGenerated = doc.columns.map((c) => ({
      name: c.name,
      def:  c.description || `Autodetected ${c.type} column`,
    }));

    const all = [...predefined];
    for (const ag of autoGenerated) {
      if (!all.find((d) => d.name.toLowerCase() === ag.name.toLowerCase())) all.push(ag);
    }
    return all;
  }
  return predefined;
}

export async function getRegistryInfo(user) {
  const docs = await datasetService.listFor(user);
  return {
    totalDatasets: docs.length,
    datasets: docs.map((d) => ({
      name: d.name,
      source: d.source,
      rowCount: d.rowCount,
      columns: d.columns.length,
    })),
  };
}
