import { Database, ChevronDown, FileText, FileSpreadsheet, CircleDot } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function DropdownRegistry() {
  const {
    registryOpen, setRegistryOpen,
    setDictOpen, setRestrictOpen,
    activeTab, uploadedFile,
    registryRef,
    registryInfo,
  } = useApp();

  // Use real registry info; fall back to static labels if not yet available
  const companyDatasets = (registryInfo?.datasets ?? []).filter(d => d.source === "company");

  return (
    <div className="relative" ref={registryRef}>
      <button onClick={() => { setRegistryOpen(!registryOpen); setDictOpen(false); setRestrictOpen(false); }}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all hover:shadow-sm"
        style={{ borderColor: registryOpen ? "#4f46e5" : "#e8eaed", background: registryOpen ? "#f0f0ff" : "#fff", color: "#1a1a2e" }}>
        <Database size={14} style={{ color: "#4f46e5" }} /> Data Registry
        <ChevronDown size={14} style={{ color: "#9ca3af", transform: registryOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>
      {registryOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border shadow-2xl z-50 overflow-hidden dropdown-enter" style={{ background: "#fff", borderColor: "#e8eaed" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#f0f0f0" }}>
            <p className="text-[11px] uppercase tracking-widest font-bold" style={{ color: "#9ca3af" }}>
              {activeTab === "company" ? "Connected Datasets" : "Uploaded Datasets"}
            </p>
          </div>
          {activeTab === "company" ? companyDatasets.map((ds, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5 border-b last:border-0" style={{ borderColor: "#f5f5f5" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#f0f0ff" }}>
                <FileText size={14} style={{ color: "#4f46e5" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#1a1a2e" }}>{ds.name}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs font-medium" style={{ color: "#6b7280" }}>{ds.rowCount?.toLocaleString() ?? "—"} rows · {ds.columns} cols</span>
                  <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: "#22c55e" }}><CircleDot size={10} /> Active</span>
                </div>
              </div>
            </div>
          )) : uploadedFile ? (
            <div className="flex items-start gap-3 px-4 py-3.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#f0f0ff" }}>
                <FileSpreadsheet size={14} style={{ color: "#4f46e5" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#1a1a2e" }}>{uploadedFile?.name ?? uploadedFile}</p>
                <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>Uploaded just now</p>
                <span className="flex items-center gap-1 text-xs font-semibold mt-1" style={{ color: "#22c55e" }}><CircleDot size={10} /> Active</span>
              </div>
            </div>
          ) : (
            <div className="px-4 py-6 text-center"><p className="text-sm" style={{ color: "#9ca3af" }}>No datasets uploaded yet</p></div>
          )}
        </div>
      )}
    </div>
  );
}
