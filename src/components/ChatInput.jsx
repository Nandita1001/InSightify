import { Send, Loader2 } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function ChatInput() {
  const { input, setInput, handleSend, isLoading } = useApp();

  const canSend = input.trim().length > 0 && !isLoading;

  return (
    <div className="px-8 pb-5 pt-2">
      <div
        className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-sm"
        style={{ background: "#fff", borderColor: "#e8eaed" }}
      >
        {/* Text input */}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && canSend && handleSend()}
          placeholder="Ask anything about your data..."
          className="flex-1 text-sm outline-none border-0 bg-transparent"
          style={{ color: "#1a1a2e" }}
          disabled={isLoading}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
          style={{
            background: canSend ? "linear-gradient(135deg, #4f46e5, #7c3aed)" : "#e8eaed",
            opacity: canSend ? 1 : 0.5,
          }}
        >
          {isLoading ? (
            <Loader2 size={16} color="#fff" className="animate-spin" />
          ) : (
            <Send size={16} color={canSend ? "#fff" : "#9ca3af"} />
          )}
        </button>
      </div>
    </div>
  );
}
