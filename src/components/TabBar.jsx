import { Database, FileSpreadsheet } from "lucide-react";
import { useApp } from "../context/AppContext";
import DropdownRegistry from "./DropdownRegistry";
import DropdownDictionary from "./DropdownDictionary";
import DropdownRestrictions from "./DropdownRestrictions";

export default function TabBar() {
  const { activeTab, setActiveTab, role } = useApp();

  return (
    <div className="flex items-center gap-2 px-6 py-3 border-b flex-wrap" style={{ background: "#fff", borderColor: "#e8eaed" }}>
      <button onClick={() => setActiveTab("company")}
        className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all"
        style={activeTab === "company" ? { background: "#4f46e5", color: "#fff" } : { background: "#f0f0ff", color: "#4f46e5" }}>
        <Database size={15} /> Company Data
      </button>
      <button onClick={() => setActiveTab("upload")}
        className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all"
        style={activeTab === "upload" ? { background: "#4f46e5", color: "#fff" } : { background: "#f0f0ff", color: "#4f46e5" }}>
        <FileSpreadsheet size={15} /> My Data
      </button>

      <div className="flex-1" />

      <DropdownRegistry />
      <DropdownDictionary />
      {role !== "Owner" && <DropdownRestrictions />}
    </div>
  );
}
