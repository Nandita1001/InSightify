import { Sparkles, Upload, FileText, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import MessageBubble from "./MessageBubble";
import LoadingIndicator from "./LoadingIndicator";

export default function ChatArea() {
  const {
    activeTab,
    displayMessages,
    uploadedFile,
    setInput,
    fileRef,
    chatEndRef,
    suggestedQuestions,
    isLoading,
    handleFileUpload,
    handleNewChat,
  } = useApp();

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const hasMessages = displayMessages.length > 0 || isLoading;

  /* ──────────────────────────────────────────
     MY DATA TAB — Upload zone (no file yet)
  ────────────────────────────────────────── */
  if (activeTab === "upload" && !uploadedFile) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col items-center justify-center">
        {/* Hidden file input */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.tsv"
          style={{ display: "none" }}
          onChange={onFileChange}
        />

        {/* Upload zone */}
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: "#f0f0ff" }}>
          <Upload size={28} style={{ color: "#4f46e5" }} />
        </div>

        <h2 className="text-2xl font-bold mb-2" style={{ color: "#1a1a2e" }}>
          Upload your dataset
        </h2>
        <p className="text-sm max-w-md text-center mb-8" style={{ color: "#9ca3af" }}>
          Upload a CSV or Excel file and start asking questions about your own data —
          with no restrictions and full access to every column.
        </p>

        <button
          onClick={() => fileRef.current?.click()}
          className="w-80 py-10 rounded-2xl border-2 border-dashed flex flex-col items-center gap-3 transition-all hover:shadow-lg hover:border-indigo-400 cursor-pointer"
          style={{ borderColor: "#d1d5db", background: "#fff" }}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: "#f0f0ff" }}
          >
            <Upload size={24} style={{ color: "#4f46e5" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#1a1a2e" }}>
              Click to upload a file
            </p>
            <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>
              CSV, Excel (.xlsx, .xls), or TSV
            </p>
          </div>
        </button>

        <p className="text-xs mt-6" style={{ color: "#c4c9d4" }}>
          Your data stays local — nothing is sent to any server
        </p>
      </div>
    );
  }

  /* ──────────────────────────────────────────
     MY DATA TAB — File uploaded, show chat
  ────────────────────────────────────────── */
  if (activeTab === "upload" && uploadedFile) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Hidden file input (for re-upload) */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,.tsv"
          style={{ display: "none" }}
          onChange={onFileChange}
        />

        {/* Dataset banner */}
        <div
          className="mx-8 mt-4 mb-2 px-4 py-3 rounded-xl flex items-center gap-3 border"
          style={{ background: "#f0f0ff", borderColor: "#c7d2fe" }}
        >
          <FileText size={18} style={{ color: "#4f46e5", flexShrink: 0 }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "#1a1a2e" }}>
              {uploadedFile.name}
            </p>
            <p className="text-xs" style={{ color: "#6366f1" }}>
              connected · no restrictions · full access
            </p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="text-xs px-3 py-1 rounded-lg border transition-all hover:bg-indigo-50 flex-shrink-0"
            style={{ borderColor: "#a5b4fc", color: "#4f46e5" }}
          >
            Change file
          </button>
          <button
            onClick={handleNewChat}
            title="Remove dataset"
            className="flex-shrink-0 hover:opacity-60 transition-opacity"
            style={{ color: "#6b7280" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-8 py-2">
          {hasMessages ? (
            <div className="max-w-3xl mx-auto space-y-5">
              {displayMessages.map((msg, idx) => (
                <div key={idx}>
                  <MessageBubble msg={msg} idx={idx} />
                </div>
              ))}
              {isLoading && <LoadingIndicator />}
              <div ref={chatEndRef} />
            </div>
          ) : (
            /* Suggested questions for uploaded dataset */
            suggestedQuestions.length > 0 ? (
              <div className="max-w-3xl mx-auto">
                <p className="text-sm font-medium mb-3" style={{ color: "#6b7280" }}>
                  Try asking:
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {suggestedQuestions.map((q, i) => {
                    const text = typeof q === "string" ? q : q.text;
                    return (
                      <button
                        key={i}
                        onClick={() => setInput(text)}
                        className="text-left p-4 rounded-xl border transition-all hover:shadow-md hover:border-indigo-300"
                        style={{ background: "#fff", borderColor: "#e8eaed" }}
                      >
                        <p className="text-sm" style={{ color: "#4b5563" }}>{text}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Sparkles size={28} className="mb-3" style={{ color: "#4f46e5" }} />
                <p className="text-sm" style={{ color: "#9ca3af" }}>
                  Ask me anything about your data
                </p>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  /* ──────────────────────────────────────────
     COMPANY DATA TAB
  ────────────────────────────────────────── */
  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls,.tsv"
        style={{ display: "none" }}
        onChange={onFileChange}
      />

      {!hasMessages ? (
        /* ── Empty state ── */
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: "#f0f0ff" }}
          >
            <Sparkles size={28} style={{ color: "#4f46e5" }} />
          </div>

          <h2 className="text-2xl font-bold mb-2" style={{ color: "#1a1a2e" }}>
            Ask your data anything
          </h2>

          <p className="text-sm max-w-md mb-8" style={{ color: "#9ca3af" }}>
            Get instant insights from your company data using natural language.
            Just type your question below.
          </p>

          {/* Suggested question cards */}
          <div className="grid grid-cols-2 gap-3 max-w-xl w-full">
            {suggestedQuestions.map((q, i) => {
              const text = typeof q === "string" ? q : q.text;
              return (
                <button
                  key={i}
                  onClick={() => setInput(text)}
                  className="text-left p-4 rounded-xl border transition-all hover:shadow-md hover:border-indigo-300"
                  style={{ background: "#fff", borderColor: "#e8eaed" }}
                >
                  <p className="text-sm" style={{ color: "#4b5563" }}>{text}</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── Message list ── */
        <div className="max-w-3xl mx-auto space-y-5">
          {displayMessages.map((msg, idx) => (
            <div key={idx}>
              <MessageBubble msg={msg} idx={idx} />
            </div>
          ))}
          {isLoading && <LoadingIndicator />}
          <div ref={chatEndRef} />
        </div>
      )}
    </div>
  );
}
