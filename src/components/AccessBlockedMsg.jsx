import { Lock } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function AccessBlockedMsg({ msg }) {
  const { handleRequestAccess, role } = useApp();

  const columns  = msg.blockedColumns ?? [];
  const reasons  = msg.blockedReasons ?? [];

  return (
    <div className="flex justify-start">
      <div
        className="max-w-xl rounded-2xl rounded-tl-md border overflow-hidden"
        style={{ borderColor: "#fde68a", background: "#fffbeb" }}
      >
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Lock size={16} style={{ color: "#f59e0b" }} />
            <span className="text-sm font-bold" style={{ color: "#92400e" }}>
              Access Restricted
            </span>
          </div>

          <p className="text-sm mb-3" style={{ color: "#78350f" }}>
            This query requires access to columns that are restricted for the{" "}
            <strong>{role}</strong> role:
          </p>

          {/* Column chips with reasons */}
          <div className="space-y-1.5 mb-4">
            {reasons.length > 0
              ? reasons.map((b, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span
                      className="px-2 py-0.5 rounded-md text-[11px] font-semibold shrink-0"
                      style={{ background: "#fef3c7", color: "#92400e" }}
                    >
                      {b.col}
                    </span>
                    <span className="text-[11px]" style={{ color: "#b45309" }}>
                      {b.reason}
                    </span>
                  </div>
                ))
              : columns.map((col) => (
                  <span
                    key={col}
                    className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold mr-1"
                    style={{ background: "#fef3c7", color: "#92400e" }}
                  >
                    {col}
                  </span>
                ))}
          </div>

          <button
            onClick={() => handleRequestAccess(columns)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}
          >
            <Lock size={14} /> Request Access
          </button>
          <p className="text-[11px] mt-2" style={{ color: "#b45309" }}>
            The data owner will be notified of your request.
          </p>
        </div>

        <div className="px-5 py-1.5 border-t" style={{ borderColor: "#fde68a" }}>
          <p className="text-[11px]" style={{ color: "#d97706" }}>
            {msg.time}
          </p>
        </div>
      </div>
    </div>
  );
}
