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
  createAccessRequest,
  getAccessRequests,
  getPendingRequests,
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

function formatForChart(result, chartType, intent) {
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
  uploadedDatasetId
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
      analysisPlan = await parseQuery(question, availableDatasets, conversationContext);
    } catch {
      analysisPlan = fallbackParseQuery(question, availableDatasets);
    }

    // Validate the plan has enough to work with
    if (
      !analysisPlan ||
      (analysisPlan.datasets ?? []).length === 0 ||
      (analysisPlan.operations ?? []).length === 0
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
      let found = findDatasetByName(dsName);

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

    /* ── Step 4: Collect all required columns ── */
    // Seed from the top-level columns list the planner emitted
    const allRequiredColumns = new Set(plan.columns ?? []);

    for (const op of plan.operations) {
      const p = op.params ?? {};

      // Single-column params
      for (const key of ["metricCol", "groupCol", "timeCol", "column", "col1", "col2", "textCol"]) {
        if (typeof p[key] === "string" && p[key]) allRequiredColumns.add(p[key]);
      }

      // Array-of-column params
      for (const arr of [p.metricCols, p.columns].filter(Array.isArray)) {
        for (const c of arr) if (typeof c === "string" && c) allRequiredColumns.add(c);
      }

      // Recursive formula extraction (computeMetric)
      if (p.formula) extractFormulaColumns(p.formula, allRequiredColumns);
    }

    /* ── Step 5: Access control — MUST run before any data processing ── */
    const accessResult = checkAccess(role, Array.from(allRequiredColumns));

    if (!accessResult.allowed) {
      return {
        type: "blocked",
        blockedColumns: accessResult.blockedColumns, // [{ col, reason }]
        role,
      };
    }

    /* ── Step 6: Execute the operations ── */
    let data = resolvedDatasets[0].data;
    let analysisResult = null;

    let allMetadata = {
      columnsUsed: [],
      rowsAnalyzed: 0,
      method: "",
      filters: null
    };

    // Operation dispatcher — maps function name → actual import
    const OPS = {
      aggregate, filter, sort, topN, trend, compare, breakdown,
      anomaly, correlation, computeMetric, joinDatasets, summarize,
      searchText, extractThemes, sentimentScan
    };

    const executionLog = [];

    for (const op of plan.operations ?? []) {
      const fn = OPS[op.function];
      if (!fn) {
        executionLog.push({ op: op.function, error: "Unknown operation" });
        continue;
      }

      try {
        const p = op.params ?? {};
        let opResult;

        switch (op.function) {
          case "aggregate":
            opResult = fn(data, p.metricCol, p.groupCol, p.aggType);
            break;
          case "filter":
            opResult = fn(data, p.column, p.operator, p.value);
            data = opResult.result; // filter mutates working set
            break;
          case "sort":
            opResult = fn(data, p.column, p.direction);
            break;
          case "topN":
            opResult = fn(data, p.metricCol, p.n, p.direction);
            break;
          case "trend":
            opResult = fn(data, p.timeCol, p.metricCol, p.groupCol);
            break;
          case "compare":
            opResult = fn(data, p.groupCol, p.metricCols);
            break;
          case "breakdown":
            opResult = fn(data, p.metricCol, p.groupCol);
            break;
          case "anomaly":
            opResult = fn(data, p.metricCol, p.threshold);
            break;
          case "correlation":
            opResult = fn(data, p.col1, p.col2);
            break;
          case "computeMetric":
            opResult = fn(data, p.formula, p.resultName, p.groupCol);
            break;
          case "joinDatasets": {
            const ds2 = p.dataset2 ? (findDatasetByName(p.dataset2) ?? getDataset(p.dataset2)) : null;
            if (ds2) {
              opResult = fn(data, ds2.data, p.joinCol);
              data = opResult.result; // joins mutate working set
            } else {
              opResult = { result: data, metadata: { method: "joinDatasets skipped", columnsUsed: [], rowsAnalyzed: 0, filters: null } };
            }
            break;
          }
          case "summarize":
            opResult = fn(data, p.columns);
            break;
          case "searchText":
            opResult = fn(data, p.textCol, p.query);
            break;
          case "extractThemes":
            opResult = fn(data, p.textCol);
            break;
          case "sentimentScan":
            opResult = fn(data, p.textCol, p.groupCol ?? null);
            break;
          default:
             opResult = { result: data, metadata: { method: op.function, columnsUsed: [], rowsAnalyzed: data.length, filters: null } };
        }

        if (opResult) {
          analysisResult = opResult;
          executionLog.push({ op: op.function, ...opResult });

          const m = opResult.metadata;
          if (m) {
            allMetadata.columnsUsed = [...new Set([...allMetadata.columnsUsed, ...(m.columnsUsed || [])])].filter(Boolean);
            allMetadata.rowsAnalyzed = Math.max(allMetadata.rowsAnalyzed, m.rowsAnalyzed || 0);
            allMetadata.method = allMetadata.method ? allMetadata.method + " → " + m.method : m.method;
            if (m.filters) {
              allMetadata.filters = allMetadata.filters ? allMetadata.filters + " AND " + m.filters : m.filters;
            }
          }
        }
      } catch (err) {
        console.error("Operation failed:", op.function, err);
        executionLog.push({ op: op.function, error: String(err) });
      }
    }

    if (!analysisResult) {
      return { type: "error", message: "No valid operations could be executed for this question." };
    }

    /* ── Step 7: Generate narrative ── */
    /* ── Step 8: Generate narrative ── */
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
    const effectiveChartType = hasGroupRanking ? "bar" : (plan.chartType || "bar");

    const chartData = formatForChart(analysisResult.result, effectiveChartType, plan.intent);

    return {
      type: "success",
      narrative,
      chartData,
      chartType: effectiveChartType,
      title: plan.title || `${plan.intent} analysis`,
      trust: {
        intent: plan.intent,
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

export function getSuggestedQuestions(activeTab, uploadedDatasetId) {
  if (activeTab === "company") {
    return [
      "What is the revenue by region?",
      "Show top 5 products by revenue",
      "How is churn trending over time?",
      "Compare Q1 and Q2 revenue"
    ];
  } else if (activeTab === "upload" && uploadedDatasetId) {
    const ds = getDatasetSummary(uploadedDatasetId);
    if (!ds) return [];
    
    // Dynamic based on columns
    const numericCols = ds.columns.filter(c => c.type === "numeric");
    const catCols = ds.columns.filter(c => c.type === "categorical");
    
    const suggested = [];
    if (numericCols.length > 0 && catCols.length > 0) {
      suggested.push(`Show total ${numericCols[0].name.toLowerCase()} by ${catCols[0].name.toLowerCase()}`);
      if (catCols.length > 1) {
         suggested.push(`Breakdown ${numericCols[0].name.toLowerCase()} by ${catCols[1].name.toLowerCase()}`);
      }
    }
    if (numericCols.length > 0) {
       suggested.push(`What is the average ${numericCols[0].name.toLowerCase()}?`);
    }
    return suggested;
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
