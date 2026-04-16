/**
 * queryEngine.js — Central Query Orchestrator
 *
 * Coordinates: parseQuery → accessControl → dataRegistry → analysisOps → generateNarrative
 * to turn a natural-language question into a fully structured response.
 */

/* ── Registry ── */
import {
  getRegistry,
  getDataset,
  findDatasetByName,
  getDatasetSummary,
} from "./dataRegistry.js";

/* ── Analysis operations ── */
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

/* ── Access control ── */
import {
  checkAccess,
  getRestrictions,
} from "./accessControl.js";

/* ── Gemini API + fallbacks ── */
import {
  parseQuery,
  generateNarrative,
  fallbackParseQuery,
  fallbackNarrative,
  isApiAvailable,
} from "./geminiApi.js";

import { DATA_DICTIONARY } from "../data/dataDictionary.js";

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
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Groq API key is missing.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Groq API ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("Groq returned empty response.");
  }

  return text;
}

function formatUnstructuredRows(rows = []) {
  return rows
    .map((row) =>
      Object.values(row ?? {})
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
        .map((value) => String(value).trim())
        .join(" | ")
    )
    .filter(Boolean)
    .join("\n");
}

async function handleUnstructuredQuery(question, dataset) {
  try {
    const datasetText = formatUnstructuredRows(dataset?.data ?? []).slice(0, 12000);

    if (!datasetText) {
      return {
        type: "error",
        message: "The unstructured dataset does not contain any readable text.",
      };
    }

    const prompt = `You are a data analyst.

User Question:
${question}

Dataset:
${datasetText}

Answer ONLY based on the dataset.
Do not assume anything not present in the data.`;

    const answer = await callGroqForUnstructured(prompt);

    return {
      type: "text",
      answer,
      source: "Unstructured Dataset (Groq)",
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
export async function processQuery(
  question,
  role,
  conversationContext,
  activeTab,
  uploadedDatasetId,
  user = {}
) {
  try {
    /* ── Step 1: Build available datasets ── */
    let availableDatasets;

    if (activeTab === "upload" && uploadedDatasetId) {
      // User mode: only the dataset they uploaded
      const summary = getDatasetSummary(uploadedDatasetId);
      availableDatasets = summary ? [summary] : [];
    } else {
      // Company mode: all company-sourced datasets (excludes uploads)
      availableDatasets = getRegistry()
        .filter((ds) => ds.source === "company")
        .map((ds) => getDatasetSummary(ds.id))
        .filter(Boolean); // drop any undefined summaries
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
    const accessResult = checkAccess(role, user.id, Array.from(allRequiredColumns));

    if (!accessResult.allowed) {
      return {
        type: "blocked",
        blockedColumns: accessResult.blockedColumns,
        role,
        restrictions: getRestrictions(role, user.id),
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

export function getSuggestedQuestions(activeTab, uploadedDatasetId, role = "Owner") {
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
    const ds = getDatasetSummary(uploadedDatasetId);
    if (!ds) return [];

    const numericCols = ds.columns.filter((c) => c.type === "numeric");
    const catCols     = ds.columns.filter((c) => c.type === "categorical");
    const textCols    = ds.columns.filter((c) => c.type === "text");
    const dateCols    = ds.columns.filter((c) => c.type === "date");

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

export function getDataDictionary(activeTab, uploadedDatasetId) {
  const predefined = DATA_DICTIONARY;
  
  if (activeTab === "company") {
     return predefined;
  } else if (activeTab === "upload" && uploadedDatasetId) {
     const ds = getDatasetSummary(uploadedDatasetId);
     if (!ds) return predefined;
     
     const autoGenerated = ds.columns.map(c => ({
        name: c.name,
        def: c.description || `Autodetected ${c.type} column`
     }));
     
     // Merge without duplicate names
     const all = [...predefined];
     for (const ag of autoGenerated) {
        if (!all.find(d => d.name.toLowerCase() === ag.name.toLowerCase())) {
           all.push(ag);
        }
     }
     return all;
  }
  return predefined;
}

export function getRegistryInfo() {
   const reg = getRegistry();
   return {
      totalDatasets: reg.length,
      datasets: reg.map(d => ({
         name: d.name,
         source: d.source,
         rowCount: d.rowCount,
         columns: d.columns.length
      }))
   };
}
