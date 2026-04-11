import { BookOpen, ChevronDown } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function DropdownDictionary() {
  const {
    dictOpen, setDictOpen,
    setRegistryOpen, setRestrictOpen,
    dictRef,
    dataDictionary,
  } = useApp();

  return (
    <div className="relative" ref={dictRef}>
      <button onClick={() => { setDictOpen(!dictOpen); setRegistryOpen(false); setRestrictOpen(false); }}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all hover:shadow-sm"
        style={{ borderColor: dictOpen ? "#4f46e5" : "#e8eaed", background: dictOpen ? "#f0f0ff" : "#fff", color: "#1a1a2e" }}>
        <BookOpen size={14} style={{ color: "#4f46e5" }} /> Data Dictionary
        <ChevronDown size={14} style={{ color: "#9ca3af", transform: dictOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>
      {dictOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border shadow-2xl z-50 overflow-hidden dropdown-enter" style={{ background: "#fff", borderColor: "#e8eaed", maxHeight: 400, overflowY: "auto" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "#f0f0f0" }}>
            <p className="text-[11px] uppercase tracking-widest font-bold" style={{ color: "#9ca3af" }}>Metric Definitions</p>
          </div>
          {(dataDictionary ?? []).map((item, i) => (
            <div key={i} className="px-4 py-3 border-b last:border-0" style={{ borderColor: "#f5f5f5" }}>
              <div className="flex items-start gap-2.5">
                <BookOpen size={14} className="mt-0.5 flex-shrink-0" style={{ color: "#4f46e5" }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#1a1a2e" }}>{item.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>{item.def}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
