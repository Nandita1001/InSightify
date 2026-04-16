import { CheckCircle } from "lucide-react";
import { AppProvider, useApp } from "./context/AppContext";
import Header from "./components/Header";
import TabBar from "./components/TabBar";
import ChatSidebar from "./components/ChatSidebar";
import ChatArea from "./components/ChatArea";
import ChatInput from "./components/ChatInput";
import LoginPage from "./components/LoginPage";
import SignupPage from "./components/SignupPage";

function AppContent() {
  const { notification, isAuthenticated, isAuthLoading, authView } = useApp();

  if (isAuthLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "#f8f9fb" }}
      >
        <div
          className="w-9 h-9 rounded-full border-[3px] border-t-transparent animate-spin"
          style={{ borderColor: "#4f46e5", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return authView === "signup" ? <SignupPage /> : <LoginPage />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#f8f9fb", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#1a1a2e" }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* NOTIFICATION TOAST */}
      {notification && (
        <div className="fixed top-5 right-5 z-[100] px-5 py-3 rounded-2xl shadow-xl text-sm font-semibold flex items-center gap-2 toast-enter"
          style={{ background: "#1a1a2e", color: "#fff" }}>
          <CheckCircle size={16} style={{ color: "#4ade80" }} />
          {notification}
        </div>
      )}

      <Header />
      <TabBar />

      {/* MAIN CONTENT */}
      <div className="flex flex-1 overflow-hidden" style={{ height: "calc(100vh - 140px)" }}>
        <ChatSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <ChatArea />
          <ChatInput />
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f8f9fb; }
        ::placeholder { color: #b0b8c8; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        @keyframes dropdownIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .dropdown-enter { animation: dropdownIn 0.18s ease-out; }
        @keyframes toastIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        .toast-enter { animation: toastIn 0.25s ease-out; }
      `}</style>
    </div>
  );
}

export default function TalkToData() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
