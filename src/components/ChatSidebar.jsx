import { MessageSquare, Plus, Upload } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function ChatSidebar() {
  const { role, roleChats, activeChatId, handleNewChat, switchChat, isUploadTab, uploadedFile } = useApp();

  return (
    <div className="w-56 flex-shrink-0 border-r flex flex-col" style={{ background: "#fff", borderColor: "#e8eaed" }}>
      <div className="p-4">
        <button onClick={handleNewChat} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90"
          style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}>
          {isUploadTab ? <Upload size={16} /> : <Plus size={16} />}
          {isUploadTab ? (uploadedFile ? "Remove Dataset" : "Upload File") : "New Chat"}
        </button>
      </div>

      {isUploadTab ? (
        /* Upload tab: show info instead of chat list */
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
          <Upload size={28} className="mb-3" style={{ color: "#c7d2fe" }} />
          <p className="text-xs font-medium" style={{ color: "#9ca3af" }}>
            {uploadedFile
              ? "You're in My Data mode"
              : "Upload a file to start chatting with your own data"}
          </p>
          {uploadedFile && (
            <p className="text-xs mt-2 font-semibold truncate w-full" style={{ color: "#4f46e5" }}>
              {uploadedFile.name}
            </p>
          )}
        </div>
      ) : (
        /* Company tab: full chat history */
        <div className="flex-1 overflow-y-auto px-3">
          {roleChats.map((chat) => (
            <div key={chat.id} onClick={() => switchChat(chat.id)}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-1 cursor-pointer transition-colors"
              style={{ background: chat.id === activeChatId ? "#f0f0ff" : "transparent" }}
              onMouseEnter={(e) => { if (chat.id !== activeChatId) e.currentTarget.style.background = "#f8f9fb"; }}
              onMouseLeave={(e) => { if (chat.id !== activeChatId) e.currentTarget.style.background = "transparent"; }}>
              <MessageSquare size={14} style={{ color: chat.id === activeChatId ? "#4f46e5" : "#9ca3af" }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: chat.id === activeChatId ? "#1a1a2e" : "#6b7280" }}>{chat.name}</p>
                <p className="text-[11px]" style={{ color: "#9ca3af" }}>{chat.time}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-3 border-t" style={{ borderColor: "#e8eaed" }}>
        <p className="text-xs font-semibold" style={{ color: "#1a1a2e" }}>{role}</p>
        <p className="text-[11px]" style={{ color: "#9ca3af" }}>
          {isUploadTab ? "My Data mode" : `${roleChats.length} chat${roleChats.length !== 1 ? "s" : ""}`}
        </p>
      </div>
    </div>
  );
}
