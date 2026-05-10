import { CheckCircle, Info, Zap, FileSearch } from "lucide-react";
import { useApp } from "../context/AppContext";

const INTENT_LABELS = {
  breakdown:       "Breakdown Analysis",
  comparison:      "Comparison",
  trend:           "Trend Analysis",
  summary:         "Summary",
  ranking:         "Ranking",
  anomaly:         "Anomaly Detection",
  correlation:     "Correlation",
  computed_metric: "Computed Metric",
  text_search:     "Text Search",
  sentiment:       "Sentiment Analysis",
};

const LABEL_MAP = {
  intent:       "Intent",
  datasetsUsed: "Datasets",
  columnsUsed:  "Columns",
  rowsAnalyzed: "Rows Analyzed",
  method:       "Method",
  source:       "Source",
};

function formatVal(key, val) {
  if (Array.isArray(val))                         return val.join(", ") || "—";
  if (key === "rowsAnalyzed" && typeof val === "number") return val.toLocaleString();
  if (key === "intent")                           return INTENT_LABELS[val] ?? val;
  if (val === null || val === undefined || val === "") return "—";
  return String(val);
}

export default function TrustPanel({ trust, idx }) {
  const { expandedTrust, setExpandedTrust } = useApp();
  if (!trust) return null;

  const isExpanded = expandedTrust === idx;

  return (
    <>
      <button
        onClick={() => setExpandedTrust(isExpanded ? null : idx)}
        className="flex items-center gap-1.5 mt-3 text-xs font-medium transition-colors hover:text-indigo-600"
        style={{ color: "#6b7280" }}
      >
        <Info size={13} />
        {isExpanded ? "Hide details" : "How we got this answer"}
      </button>

      {isExpanded && (
        <div
          className="mt-2 rounded-xl p-4 border-l-4 dropdown-enter"
          style={{ background: "#f0fdf4", borderColor: "#22c55e" }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={14} style={{ color: "#22c55e" }} />
            <span className="text-xs font-bold" style={{ color: "#166534" }}>
              {trust.aiPowered ? "AI-Powered Analysis" : "Analysis Verified"}
            </span>
            {trust.aiPowered && (
              <span
                className="flex items-center gap-1 text-xs font-semibold ml-auto"
                style={{ color: "#6366f1" }}
              >
                <Zap size={11} /> AI-powered
              </span>
            )}
          </div>

          {/* Fields */}
          <div className="grid grid-cols-1 gap-y-2">
            {Object.entries(LABEL_MAP).map(([key, label]) => {
              const val = trust[key];
              if (val === undefined) return null;
              return (
                <div key={key} className="text-xs flex gap-2">
                  <span
                    className="font-medium shrink-0"
                    style={{ color: "#6b7280", minWidth: 100 }}
                  >
                    {label}:
                  </span>
                  <span className="font-semibold break-all" style={{ color: "#1a1a2e" }}>
                    {formatVal(key, val)}
                  </span>
                </div>
              );
            })}

            {/* Source on its own line (can be long) */}
            {trust.source && (
              <div className="text-xs flex gap-2">
                <span className="font-medium shrink-0" style={{ color: "#6b7280", minWidth: 100 }}>
                  Source:
                </span>
                <span className="font-semibold break-all" style={{ color: "#1a1a2e" }}>
                  {trust.source}
                </span>
              </div>
            )}
          </div>

          {/* Cross-dataset RAG context — only shown when chunks were retrieved */}
          {Array.isArray(trust.context) && trust.context.length > 0 && (
            <div
              className="mt-4 pt-3 border-t"
              style={{ borderColor: "#bbf7d0" }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <FileSearch size={12} style={{ color: "#166534" }} />
                <span className="text-xs font-bold" style={{ color: "#166534" }}>
                  Cross-dataset context
                </span>
                <span className="text-[10px] font-medium" style={{ color: "#6b7280" }}>
                  {trust.context.length} of {trust.contextScanned ?? "?"} chunks above relevance threshold
                </span>
              </div>
              <div className="space-y-1.5">
                {trust.context.map((c, i) => (
                  <div
                    key={i}
                    className="text-[11px] rounded-lg p-2"
                    style={{ background: "#fff", border: "1px solid #d1fae5" }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold"
                        style={{ background: "#dcfce7", color: "#166534" }}
                      >
                        {(c.score * 100).toFixed(0)}%
                      </span>
                      <span className="font-semibold" style={{ color: "#1a1a2e" }}>
                        {c.datasetName || "Unknown dataset"}
                      </span>
                      <span style={{ color: "#9ca3af" }}>row {c.rowIndex + 1}</span>
                    </div>
                    <p className="leading-snug break-words" style={{ color: "#4b5563" }}>
                      {c.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
