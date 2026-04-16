import {
  Database, Shield, Users, FileText, BarChart3,
  Bell, X, CheckCircle, XCircle, Clock, LogOut,
} from "lucide-react";
import { useApp } from "../context/AppContext";

const ROLE_ICONS = {
  Owner: Shield,
  "Finance Team": FileText,
  "Marketing Team": BarChart3,
  "HR Team": Users,
};

export default function Header() {
  const {
    role, currentUser, logout,
    bellOpen, setBellOpen,
    pendingCount, accessRequests, handleAccess,
    bellRef,
  } = useApp();

  const RoleIcon = ROLE_ICONS[role] ?? Users;
  const initials = currentUser?.name
    ? currentUser.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <header
      className="flex items-center justify-between px-6 py-4 border-b"
      style={{ background: "#fff", borderColor: "#e8eaed" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
        >
          <Database size={20} color="#fff" />
        </div>
        <div>
          <h1
            className="text-lg font-bold tracking-tight"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "#1a1a2e" }}
          >
            InSightify
          </h1>
          <p className="text-xs font-medium" style={{ color: "#9ca3af" }}>
            Talk to Your Data
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* User info pill */}
        <div
          className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl border"
          style={{ background: "#fff", borderColor: "#e8eaed" }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
          >
            {initials}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold" style={{ color: "#1a1a2e" }}>
              {currentUser?.name ?? "User"}
            </p>
            <div className="flex items-center gap-1">
              <RoleIcon size={10} style={{ color: "#4f46e5" }} />
              <p className="text-[11px] font-medium" style={{ color: "#4f46e5" }}>{role}</p>
            </div>
          </div>
        </div>

        {/* Bell — Owner only */}
        {role === "Owner" && (
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => setBellOpen(!bellOpen)}
              className="relative p-2.5 rounded-xl border transition-all hover:shadow-md"
              style={{ background: "#fff", borderColor: bellOpen ? "#4f46e5" : "#e8eaed" }}
            >
              <Bell size={18} style={{ color: "#6b7280" }} />
              {pendingCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                  style={{ background: "#ef4444" }}
                >
                  {pendingCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-96 rounded-xl border shadow-2xl z-50 overflow-hidden dropdown-enter"
                style={{ background: "#fff", borderColor: "#e8eaed", maxHeight: 480, overflowY: "auto" }}
              >
                <div
                  className="flex items-center justify-between px-4 py-3 border-b"
                  style={{ borderColor: "#f0f0f0" }}
                >
                  <p className="text-sm font-bold" style={{ color: "#1a1a2e" }}>
                    Access Requests
                    {pendingCount > 0 && (
                      <span
                        className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                        style={{ background: "#ef4444" }}
                      >
                        {pendingCount} pending
                      </span>
                    )}
                  </p>
                  <button
                    onClick={() => setBellOpen(false)}
                    className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <X size={14} style={{ color: "#9ca3af" }} />
                  </button>
                </div>

                {accessRequests.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm" style={{ color: "#9ca3af" }}>No access requests</p>
                  </div>
                ) : (
                  <div className="p-3 space-y-2">
                    {accessRequests.map((req) => (
                      <div
                        key={req.id}
                        className="p-3 rounded-xl border"
                        style={{ borderColor: "#e8eaed", background: "#fafbfc" }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div>
                            <p className="font-semibold text-sm" style={{ color: "#1a1a2e" }}>
                              {req.user_name ?? req.from_role}
                            </p>
                            <p className="text-[11px] font-medium" style={{ color: "#4f46e5" }}>
                              {req.from_role}
                            </p>
                            <p
                              className="text-[11px] flex items-center gap-1 mt-0.5"
                              style={{ color: "#9ca3af" }}
                            >
                              <Clock size={10} />
                              {req.created_at
                                ? new Date(req.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : "just now"}
                            </p>
                          </div>

                          {req.status === "pending" ? (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handleAccess(req.id, true)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90"
                                style={{ background: "#4f46e5" }}
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleAccess(req.id, false)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-gray-50"
                                style={{ borderColor: "#e8eaed", color: "#6b7280" }}
                              >
                                Deny
                              </button>
                            </div>
                          ) : (
                            <span
                              className="text-[11px] font-semibold flex items-center gap-1"
                              style={{ color: req.status === "approved" ? "#22c55e" : "#ef4444" }}
                            >
                              {req.status === "approved" ? (
                                <><CheckCircle size={12} /> Approved</>
                              ) : (
                                <><XCircle size={12} /> Denied</>
                              )}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {req.columns.map((col) => (
                            <span
                              key={col}
                              className="px-2 py-0.5 rounded-md text-[11px] font-medium"
                              style={{ background: "#f0f0ff", color: "#4f46e5" }}
                            >
                              {col}
                            </span>
                          ))}
                        </div>

                        {req.reason && (
                          <p className="text-[11px] mt-1.5 italic" style={{ color: "#9ca3af" }}>
                            {req.reason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-colors hover:bg-gray-50"
          style={{ background: "#fff", borderColor: "#e8eaed", color: "#6b7280" }}
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </header>
  );
}
