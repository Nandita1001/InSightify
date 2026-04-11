import { Sparkles, Upload } from "lucide-react";
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
  } = useApp();

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = "";
  };

  const hasMessages = displayMessages.length > 0 || isLoading;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      {/* Hidden file input for the upload-zone button */}
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
            {activeTab === "company"
              ? "Ask your data anything"
              : "Upload your data to get started"}
          </h2>

          <p className="text-sm max-w-md mb-8" style={{ color: "#9ca3af" }}>
            {activeTab === "company"
              ? "Get instant insights from your company data using natural language. Just type your question below."
              : "Upload a CSV or Excel file and start asking questions about your data instantly."}
          </p>

          {activeTab === "company" ? (
            /* Suggested question cards */
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
          ) : !uploadedFile ? (
            /* Upload drop zone */
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
                  Upload your data
                </p>
                <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>
                  CSV or Excel files
                </p>
              </div>
            </button>
          ) : (
            /* File uploaded, no messages yet — show dynamic suggestions */
            suggestedQuestions.length > 0 && (
              <div className="grid grid-cols-1 gap-3 max-w-sm w-full">
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
            )
          )}
        </div>
      ) : (
        /* ── Message list ── */
        <div className="max-w-3xl mx-auto space-y-5">
          {displayMessages.map((msg, idx) => (
            <div key={idx}>
              <MessageBubble msg={msg} idx={idx} />
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && <LoadingIndicator />}

          <div ref={chatEndRef} />
        </div>
      )}
    </div>
  );
}
