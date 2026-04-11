import { Send, Paperclip, Loader2 } from "lucide-react";
import { useRef } from "react";
import { useApp } from "../context/AppContext";

export default function ChatInput() {
  const { input, setInput, handleSend, handleFileUpload, isLoading, activeTab } = useApp();
  const localFileRef = useRef(null);

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const canSend = input.trim().length > 0 && !isLoading;

  return (
    <div className="px-8 pb-5 pt-2">
      {/* Hidden file input for Paperclip */}
      <input
        ref={localFileRef}
        type="file"
        accept=".csv,.xlsx,.xls,.tsv"
        className="hidden"
        onChange={onFileChange}
      />

      <div
        className="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-sm"
        style={{ background: "#fff", borderColor: "#e8eaed" }}
      >
        {/* Paperclip — always visible, active on upload tab */}
        <button
          type="button"
          onClick={() => localFileRef.current?.click()}
          title="Upload a CSV or Excel file"
          className="flex-shrink-0 transition-opacity hover:opacity-70"
          style={{ color: activeTab === "upload" ? "#6366f1" : "#c0c0c0" }}
        >
          <Paperclip size={18} />
        </button>

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
