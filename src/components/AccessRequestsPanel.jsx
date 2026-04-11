import { CheckCircle, Clock, XCircle } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function AccessRequestsPanel() {
  const { accessRequests, handleAccess } = useApp();

  return (
    <>
      {accessRequests.length === 0 ? (
        <div className="px-4 py-6 text-center"><p className="text-sm" style={{ color: "#9ca3af" }}>No access requests</p></div>
      ) : (
        <div className="p-3 space-y-2">
          {accessRequests.map((req) => (
            <div key={req.id} className="p-3 rounded-xl border" style={{ borderColor: "#e8eaed", background: "#fafbfc" }}>
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <p className="font-semibold text-sm" style={{ color: "#1a1a2e" }}>{req.from}</p>
                  <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: "#9ca3af" }}><Clock size={10} /> {req.time}</p>
                </div>
                {req.status === "pending" ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => handleAccess(req.id, true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90" style={{ background: "#4f46e5" }}>Approve</button>
                    <button onClick={() => handleAccess(req.id, false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border hover:bg-gray-50" style={{ borderColor: "#e8eaed", color: "#6b7280" }}>Deny</button>
                  </div>
                ) : (
                  <span className="text-[11px] font-semibold flex items-center gap-1" style={{ color: req.status === "approved" ? "#22c55e" : "#ef4444" }}>
                    {req.status === "approved" ? <><CheckCircle size={12} /> Approved</> : <><XCircle size={12} /> Denied</>}
                  </span>
                )}
              </div>
              {req.status === "pending" && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {req.columns.map((col) => (
                    <span key={col} className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: "#f0f0ff", color: "#4f46e5" }}>{col}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
