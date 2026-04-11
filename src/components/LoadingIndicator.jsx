import { Loader2 } from "lucide-react";

export default function LoadingIndicator() {
  return (
    <div className="flex justify-start">
      <div
        className="rounded-2xl rounded-tl-md border"
        style={{ borderColor: "#e8eaed", background: "#fff", padding: "16px 20px" }}
      >
        <div className="flex items-center gap-2.5" style={{ color: "#9ca3af" }}>
          <Loader2 size={16} className="animate-spin" style={{ color: "#6366f1" }} />
          <span className="text-sm font-medium" style={{ color: "#6b7280" }}>
            Analyzing your data…
          </span>
          {/* Pulsing dots */}
          <span className="flex gap-1 ml-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "#c4b5fd",
                  display: "inline-block",
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </span>
        </div>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 0.3; transform: scale(0.8); }
            50%       { opacity: 1;   transform: scale(1.2); }
          }
        `}</style>
      </div>
    </div>
  );
}
