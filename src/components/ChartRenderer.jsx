import {
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = ["#6366f1", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

/* ── Number formatter for axis ticks ── */
function fmtTick(n) {
  if (n === null || n === undefined || isNaN(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* ── Dark tooltip (shared) ── */
function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#1e1b4b",
        border: "1px solid #4338ca",
        borderRadius: 8,
        padding: "8px 12px",
        color: "#e0e7ff",
        fontSize: 12,
      }}
    >
      {label && (
        <p style={{ fontWeight: 700, marginBottom: 4, color: "#c7d2fe" }}>{label}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} style={{ margin: "2px 0", color: "#e0e7ff" }}>
          <span style={{ color: p.color ?? "#818cf8" }}>{p.name}: </span>
          <strong>{fmtTick(p.value)}</strong>
        </p>
      ))}
    </div>
  );
}

/* ── Pie label inside slice ── */
function PieSliceLabel({ cx, cy, midAngle, innerRadius, outerRadius, percentage, name }) {
  if ((percentage ?? 0) < 4) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x} y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={700}
    >
      {`${Number(percentage).toFixed(0)}%`}
    </text>
  );
}

/* ── Container wrapper ── */
const WRAP = {
  background: "#f8f9fb",
  border: "1px solid #e8eaed",
  borderRadius: 12,
  padding: 12,
  marginTop: 16,
};

export default function ChartRenderer({ data, type, height = 260 }) {
  if (!data || !Array.isArray(data) || data.length === 0) return null;

  /* ── TABLE ── */
  if (type === "table") {
    const cols = Object.keys(data[0] ?? {}).filter((k) => !k.startsWith("_"));
    const shown = Math.min(data.length, 20);
    return (
      <div style={{ ...WRAP, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f0f0ff" }}>
              {cols.map((c) => (
                <th
                  key={c}
                  style={{
                    padding: "8px 12px",
                    textAlign: "left",
                    color: "#4f46e5",
                    fontWeight: 700,
                    borderBottom: "2px solid #e8eaed",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 20).map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                {cols.map((c) => {
                  const val = row[c];
                  const str = val === null || val === undefined ? "—" : String(val);
                  return (
                    <td
                      key={c}
                      title={str.length > 60 ? str : undefined}
                      style={{
                        padding: "7px 12px",
                        color: "#374151",
                        borderBottom: "1px solid #f0f0f0",
                        maxWidth: 200,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {str.length > 100 ? str.slice(0, 100) + "…" : str}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 20 && (
          <p
            style={{
              textAlign: "right",
              fontSize: 11,
              color: "#9ca3af",
              padding: "6px 12px",
              borderTop: "1px solid #f0f0f0",
            }}
          >
            Showing {shown} of {data.length} rows
          </p>
        )}
      </div>
    );
  }

  /* ── PIE (donut) ── */
  if (type === "pie") {
    return (
      <div style={WRAP}>
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={Math.round(height * 0.19)}   /* donut */
              outerRadius={Math.round(height * 0.34)}
              labelLine={false}
              label={PieSliceLabel}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v) => fmtTick(v)}
              contentStyle={{
                background: "#1e1b4b",
                border: "1px solid #4338ca",
                borderRadius: 8,
                color: "#e0e7ff",
                fontSize: 12,
              }}
              itemStyle={{ color: "#e0e7ff" }}
              labelStyle={{ color: "#c7d2fe", fontWeight: 700 }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ── LINE ── */
  if (type === "line") {
    // Detect all metric keys (non-name keys)
    const metricKeys = Object.keys(data[0] ?? {}).filter(
      (k) => k !== "name" && typeof data[0][k] === "number"
    );
    const keys = metricKeys.length > 0 ? metricKeys : ["value"];

    return (
      <div style={WRAP}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
            <YAxis tickFormatter={fmtTick} tick={{ fontSize: 11, fill: "#9ca3af" }} width={52} />
            <Tooltip content={<DarkTooltip />} />
            {keys.length > 1 && <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
            {keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 4, fill: COLORS[i % COLORS.length] }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /* ── BAR (default) ── */
  {
    // Auto-detect all numeric data keys beyond "name"
    const metricKeys = Object.keys(data[0] ?? {}).filter(
      (k) => k !== "name" && !k.startsWith("_") && typeof data[0][k] === "number"
    );
    const keys       = metricKeys.length > 0 ? metricKeys : ["value"];
    const manyBars   = data.length > 6;

    return (
      <div style={WRAP}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 20, left: 0, bottom: manyBars ? 28 : 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="name"
              tick={{
                fontSize: 11,
                fill: "#9ca3af",
                angle: manyBars ? -30 : 0,
                textAnchor: manyBars ? "end" : "middle",
              }}
              interval={0}
            />
            <YAxis tickFormatter={fmtTick} tick={{ fontSize: 11, fill: "#9ca3af" }} width={52} />
            <Tooltip content={<DarkTooltip />} />
            {keys.length > 1 && <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} radius={[4, 4, 0, 0]} fill={COLORS[i % COLORS.length]}>
                {keys.length === 1 &&
                  data.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
}
