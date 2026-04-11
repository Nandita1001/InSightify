import { AlertTriangle } from "lucide-react";
import ChartRenderer from "./ChartRenderer";
import TrustPanel from "./TrustPanel";
import AccessBlockedMsg from "./AccessBlockedMsg";

/* ── Bold / bullet narrative renderer ── */
function renderNarrative(text) {
  if (!text) return null;
  return text.split("\n").map((line, i) => {
    // Split on **bold** markers
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={j} style={{ fontWeight: 600, color: "#1a1a2e" }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={j}>{part}</span>;
    });

    if (line.startsWith("• ")) {
      return (
        <div key={i} style={{ display: "flex", gap: 6, marginLeft: 8, marginBottom: 2 }}>
          <span style={{ color: "#4f46e5", flexShrink: 0 }}>•</span>
          <span>{parts}</span>
        </div>
      );
    }
    // blank lines → small spacer
    if (!line.trim()) {
      return <div key={i} style={{ height: 6 }} />;
    }
    return (
      <p key={i} style={{ lineHeight: 1.6, margin: "2px 0" }}>
        {parts}
      </p>
    );
  });
}

export default function MessageBubble({ msg, idx }) {
  /* ── User message ── */
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-lg px-5 py-3 rounded-2xl rounded-tr-md text-white text-sm font-medium"
          style={{ background: "linear-gradient(135deg, #4f46e5, #6366f1)" }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  /* ── Access blocked ── */
  if (msg.blocked) {
    return <AccessBlockedMsg msg={msg} />;
  }

  /* ── Error message ── */
  if (msg.isError) {
    return (
      <div className="flex justify-start">
        <div
          className="max-w-xl rounded-2xl rounded-tl-md border overflow-hidden"
          style={{ borderColor: "#fde68a", background: "#fffbf5" }}
        >
          <div className="px-5 py-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                size={16}
                className="shrink-0 mt-0.5"
                style={{ color: "#f59e0b" }}
              />
              <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>
                {renderNarrative(msg.content)}
              </div>
            </div>
          </div>
          <div className="px-5 py-1.5 border-t" style={{ borderColor: "#fde68a" }}>
            <p className="text-[11px]" style={{ color: "#c0c0c0" }}>{msg.time}</p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Normal assistant message ── */
  const hasChart = msg.chartData && Array.isArray(msg.chartData) && msg.chartData.length > 0;
  const hasTrust = !!msg.trust;

  return (
    <div className="flex justify-start">
      <div
        className="max-w-xl rounded-2xl rounded-tl-md border overflow-hidden"
        style={{ borderColor: "#e8eaed", background: "#fff" }}
      >
        <div className="px-5 py-4">
          {/* Narrative with bold + bullet rendering */}
          <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>
            {renderNarrative(msg.content)}
          </div>

          {/* Chart */}
          {hasChart && (
            <ChartRenderer
              data={msg.chartData}
              type={msg.chartType}
            />
          )}

          {/* Trust panel */}
          {hasTrust && <TrustPanel trust={msg.trust} idx={idx} />}
        </div>

        <div className="px-5 py-1.5 border-t" style={{ borderColor: "#f0f0f0" }}>
          <p className="text-[11px]" style={{ color: "#c0c0c0" }}>{msg.time}</p>
        </div>
      </div>
    </div>
  );
}
