/**
 * llmService.js — Owns prompt templates + request building for LLM calls.
 *
 * The client sends structured inputs (question, registry, analysis results) —
 * never raw prompts. The server picks the system prompt and builds the user
 * message. This prevents arbitrary prompt injection against our Groq budget.
 */

import { groqChat } from "./groqService.js";

/* ═══════════════════════════════════════════════════════════
   §1  SYSTEM PROMPTS
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

const NARRATIVE_SYSTEM = `
You are a professional data analyst.

You are given VERIFIED computed results from a system.
These numbers are ALWAYS correct.

Your job is ONLY to explain them clearly.

You may also be given retrieved context rows from related datasets (e.g.
customer feedback). These are unverified raw data, NOT computed results.

STRICT RULES:
- DO NOT invent any numbers
- DO NOT assume missing data
- ONLY use the numbers provided in "Computed Results"
- If something is missing, say "Not available"
- NEVER mention errors unless explicitly present in results
- Keep it simple and natural

CONTEXT ROW RULES:
- Cite a context row ONLY when it materially supports the answer (e.g. the
  user asked WHY a metric changed and the context provides a likely reason).
- If the context rows are unrelated to the question, IGNORE them silently.
  Do NOT mention that you saw context.
- When you do cite a context row, reference it as "[Customer Feedback Row 7]"
  using the dataset name + row number provided.

FORMAT:

✅ Final Answer
(1–2 sentences, direct answer with numbers)

📊 Key Insight
(1–2 sentences explaining why. Cite context rows here when they help.)

📁 Data Reference
(List column names or fields used)

⚠️ Notes
(Assumptions or "None")
`;

/* ═══════════════════════════════════════════════════════════
   §2  USER-PROMPT BUILDERS
═══════════════════════════════════════════════════════════ */

function buildRegistryText(registry) {
  return (registry ?? [])
    .map((ds) => {
      const cols = (ds.columns ?? [])
        .map((c) => `    - ${c.name} (${c.type})${c.description ? ": " + c.description : ""}`)
        .join("\n");
      return `Dataset: "${ds.name}"\nDescription: ${ds.description ?? ""}\nColumns:\n${cols}`;
    })
    .join("\n\n");
}

function buildContextText(context) {
  if (!context || context.length === 0) return "(no prior conversation)";
  return context
    .slice(-3)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content).slice(0, 200)}`)
    .join("\n");
}

/**
 * Build a compact summary of analysis results for the narrative prompt.
 * Mirrors the original client-side _buildResultSummary.
 */
function buildResultSummary(result, metadata) {
  if (!result) return "(no results)";

  const isCombinedResult =
    result &&
    !Array.isArray(result) &&
    !result.counts &&
    !result.groups &&
    !result.topKeywords &&
    Object.values(result).some(
      (value) =>
        Array.isArray(value) ||
        (value && typeof value === "object" && (value.counts || value.groups || value.topKeywords))
    );

  if (isCombinedResult) {
    return Object.entries(result)
      .map(([key, value]) => {
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
      })
      .join("\n");
  }

  if (result?.counts) {
    const c = result.counts;
    let summary = `Sentiment counts — Positive: ${c.positive}, Negative: ${c.negative}, Neutral: ${c.neutral}, Total: ${c.total}`;
    if (result.groupRanking && result.groupRanking.length > 0) {
      const worst = result.groupRanking[0];
      const best = result.groupRanking[result.groupRanking.length - 1];
      summary += `\nGroup ranking (worst to best): ${result.groupRanking
        .map((g) => `${g.group}(neg:${g.negativeRate}%,pos:${g.positiveRate}%)`)
        .join(", ")}`;
      summary += `\nWorst group: "${worst.group}" (${worst.negativeRate}% negative, ${worst.negative} negative entries)`;
      summary += `\nBest group: "${best.group}" (${best.positiveRate}% positive, ${best.positive} positive entries)`;
    }
    return summary;
  }

  if (result?.groups && result?.comparisons) {
    const g = result.groups.slice(0, 4).map((g) => JSON.stringify(g)).join(", ");
    const top = result.comparisons[0];
    return `Groups: [${g}]${top ? `\nBiggest gap: ${top.groupA} vs ${top.groupB} on ${top.metricCol}: diff=${top.diff}` : ""}`;
  }

  if (result?.topKeywords) {
    return `Top keywords: ${result.topKeywords.slice(0, 8).map((k) => `${k.word}(${k.count})`).join(", ")}`;
  }

  if (Array.isArray(result)) {
    if (result[0]?.error) return `Error: ${result[0].error}`;
    return result
      .slice(0, 8)
      .map((row) => {
        const clean = {};
        for (const [k, v] of Object.entries(row)) {
          if (!k.startsWith("_")) clean[k] = v;
        }
        return JSON.stringify(clean);
      })
      .join("\n");
  }

  return JSON.stringify(result).slice(0, 600);
}

/* ═══════════════════════════════════════════════════════════
   §3  PUBLIC API
═══════════════════════════════════════════════════════════ */

/**
 * Run the query-parsing prompt. Returns the raw LLM text — the client runs
 * its existing post-processing (strip fences → JSON.parse → normalize).
 */
export async function parse({ question, registry, context }) {
  const user = `Available datasets:
${buildRegistryText(registry)}

Previous conversation:
${buildContextText(context)}

User question: "${question}"`;

  const raw = await groqChat({ system: PARSE_QUERY_SYSTEM, user });
  return { raw };
}

function formatContextBlock(context = []) {
  if (!context || context.length === 0) return "";
  const lines = context.map((c) => {
    const ds = c.datasetName ? `${c.datasetName} ` : "";
    return `[${ds}Row ${(c.rowIndex ?? 0) + 1}] ${c.text}`;
  });
  return `\n\nRetrieved Context (related rows from other datasets — unverified raw data):\n${lines.join("\n")}`;
}

/**
 * Generate a narrative for already-computed analysis results, optionally
 * augmented with retrieved context chunks from related datasets. The system
 * prompt instructs the model to cite context only when it materially
 * supports the answer.
 */
export async function narrative({ result, metadata, question, context = [] }) {
  const summary = buildResultSummary(result, metadata);
  const ctxBlock = formatContextBlock(context);

  const user = `
User Question:
"${question}"

Computed Results:
${summary}${ctxBlock}

Explain these results clearly.
`;
  const text = await groqChat({ system: NARRATIVE_SYSTEM, user });
  return { text };
}

export const llmService = { parse, narrative };
