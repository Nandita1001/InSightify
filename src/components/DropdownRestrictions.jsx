import { ShieldAlert, ChevronDown, Lock } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function DropdownRestrictions() {
  const {
    restrictOpen, setRestrictOpen,
    setRegistryOpen, setDictOpen,
    restrictions,
    restrictRef,
  } = useApp();

  return (
    <div className="relative" ref={restrictRef}>
      <button onClick={() => { setRestrictOpen(!restrictOpen); setRegistryOpen(false); setDictOpen(false); }}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all hover:shadow-sm"
        style={{ borderColor: restrictOpen ? "#f59e0b" : "#e8eaed", background: restrictOpen ? "#fffbeb" : "#fff", color: "#92400e" }}>
        <ShieldAlert size={14} style={{ color: "#f59e0b" }} /> Restrictions
        {restrictions.length > 0 && (
          <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white" style={{ background: "#f59e0b" }}>{restrictions.length}</span>
        )}
        <ChevronDown size={14} style={{ color: "#d97706", transform: restrictOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>
      {restrictOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border shadow-2xl z-50 overflow-hidden dropdown-enter" style={{ background: "#fff", borderColor: "#e8eaed" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#f0f0f0", background: "#fffbeb" }}>
            <div className="flex items-center gap-2">
              <ShieldAlert size={14} style={{ color: "#f59e0b" }} />
              <p className="text-xs font-semibold" style={{ color: "#92400e" }}>You have limited access to certain data columns</p>
            </div>
          </div>
          {restrictions.map((r, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3 border-b last:border-0" style={{ borderColor: "#f5f5f5" }}>
              <Lock size={14} className="mt-0.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "#1a1a2e" }}>{r.col}</p>
                <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>{r.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
