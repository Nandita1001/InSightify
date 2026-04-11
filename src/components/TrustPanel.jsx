import { CheckCircle, Info, Zap } from "lucide-react";
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
        </div>
      )}
    </>
  );
}
