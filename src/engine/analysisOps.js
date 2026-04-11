/**
 * analysisOps.js — Data Analysis Engine: Deterministic Operations Layer
 *
 * All functions are pure / deterministic — no randomness, no LLM calls.
 * Every exported operation returns the standard envelope:
 *   {
 *     result:   any[],
 *     metadata: { columnsUsed: string[], rowsAnalyzed: number, method: string, filters: string|null }
 *   }
 *
 * Import pattern: import { aggregate, trend, ... } from './analysisOps.js'
 */

/* ═══════════════════════════════════════════════════════════
   §0  INTERNAL UTILITIES
═══════════════════════════════════════════════════════════ */

/** Safe numeric coercion — returns NaN for null/undefined/"" */
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return isNaN(n) ? NaN : n;
};

/** Return true if a value is a usable number (not null/undefined/""/NaN) */
const isValid = (v) => !isNaN(toNum(v));

/** Extract all numeric values from an array, dropping non-numerics */
const nums = (arr) => arr.map(toNum).filter((n) => !isNaN(n));

/** Find a column name in row objects with case-insensitive matching.
 *  Returns the first key from the first row that matches (lower-cased). */
function resolveCol(data, name) {
  if (!data || data.length === 0 || !name) return null;
  const lower = name.toLowerCase();
  const keys = Object.keys(data[0]);
  return keys.find((k) => k.toLowerCase() === lower) ?? null;
}

/** Build standard metadata envelope */
function meta(columnsUsed, rowsAnalyzed, method, filters = null) {
  return { columnsUsed: [].concat(columnsUsed).filter(Boolean), rowsAnalyzed, method, filters };
}

/** Build a standard error result */
function errResult(message) {
  return {
    result: [{ error: message }],
    metadata: meta([], 0, message, null),
  };
}

/* ═══════════════════════════════════════════════════════════
   §1  UTILITY EXPORTS
═══════════════════════════════════════════════════════════ */

/**
 * Format a number with commas; use K / M suffixes for large values.
 * Examples: 1500 → "1,500", 1_500_000 → "1.5M", 0.42 → "0.42"
 */
export function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Format a number as a percentage string with 1 decimal place.
 * Example: 0.1254 → "12.5%"  |  12.54 → "12.5%"
 * If value is already in percent range (>2), treat as-is; otherwise multiply by 100.
 */
export function formatPercent(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return "—";
  const val = Math.abs(Number(n)) > 2 ? Number(n) : Number(n) * 100;
  return val.toFixed(1) + "%";
}

/**
 * Date-label ordering map — assigns a chronological sort key to known label patterns.
 * Handles: bare month names ("Jan"), week labels ("W1 Jan"), quarter labels ("Q1","Q2"…),
 * fiscal quarter strings ("Q1 2024"), and ISO dates.
 */
const MONTH_ORDER = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function dateSortKey(label) {
  if (!label) return Infinity;
  const s = String(label).trim().toLowerCase();

  // ISO date: "2024-01-15"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s).getTime();

  // Bare month: "jan", "feb" …
  if (MONTH_ORDER[s]) return MONTH_ORDER[s] * 100;

  // Month + year: "jan 2024"
  const monthYear = s.match(/^([a-z]+)\s+(\d{4})$/);
  if (monthYear && MONTH_ORDER[monthYear[1]]) {
    return Number(monthYear[2]) * 10000 + MONTH_ORDER[monthYear[1]] * 100;
  }

  // Week label: "w1 jan", "w2 feb"
  const weekLabel = s.match(/^w(\d+)\s+([a-z]+)/);
  if (weekLabel && MONTH_ORDER[weekLabel[2]]) {
    return MONTH_ORDER[weekLabel[2]] * 100 + Number(weekLabel[1]);
  }

  // Quarter: "q1", "q2", "q3", "q4"
  const qOnly = s.match(/^q([1-4])$/);
  if (qOnly) return Number(qOnly[1]);

  // Quarter + year: "q1 2024"
  const qYear = s.match(/^q([1-4])\s+(\d{4})$/);
  if (qYear) return Number(qYear[2]) * 10 + Number(qYear[1]);

  // Slash dates: "1/15/2024"
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s)) return new Date(label).getTime();

  // Fallback: lexicographic
  return s;
}

/**
 * Sort an array of date-like string values into chronological order.
 * @param {string[]} values
 * @returns {string[]} sorted values
 */
export function parseDateColumn(values) {
  return [...values].sort((a, b) => {
    const ka = dateSortKey(a);
    const kb = dateSortKey(b);
    if (typeof ka === "number" && typeof kb === "number") return ka - kb;
    return String(ka).localeCompare(String(kb));
  });
}

/* ═══════════════════════════════════════════════════════════
   §2  CORE AGGREGATION
═══════════════════════════════════════════════════════════ */

/**
 * Group data by groupCol and apply an aggregation to metricCol.
 * aggType: "sum" | "avg" | "count" | "min" | "max"
 * If groupCol is null, aggregates the whole dataset into a single result row.
 * Returns rows sorted by aggregated value, descending.
 */
export function aggregate(data, metricCol, groupCol, aggType = "sum") {
  if (!data || data.length === 0) return errResult("No data provided to aggregate.");

  const mKey = resolveCol(data, metricCol);
  if (!mKey) return errResult(`Column "${metricCol}" not found in dataset.`);

  const gKey = groupCol ? resolveCol(data, groupCol) : null;
  if (groupCol && !gKey) return errResult(`Group column "${groupCol}" not found in dataset.`);

  const applyAgg = (values) => {
    const n = nums(values);
    if (aggType === "count") return values.length;
    if (n.length === 0) return null;
    switch (aggType) {
      case "sum": return n.reduce((s, x) => s + x, 0);
      case "avg": return n.reduce((s, x) => s + x, 0) / n.length;
      case "min": return Math.min(...n);
      case "max": return Math.max(...n);
      default:    return null;
    }
  };

  let result;

  if (!gKey) {
    const values = data.map((r) => r[mKey]);
    const value = applyAgg(values);
    result = [{ [mKey]: value }];
  } else {
    // Group rows
    const groups = {};
    for (const row of data) {
      const gVal = String(row[gKey] ?? "(blank)");
      if (!groups[gVal]) groups[gVal] = [];
      groups[gVal].push(row[mKey]);
    }

    result = Object.entries(groups).map(([group, values]) => ({
      [gKey]: group,
      [mKey]: applyAgg(values),
      _count: values.length,
    }));

    // Sort descending by aggregated value
    result.sort((a, b) => (b[mKey] ?? -Infinity) - (a[mKey] ?? -Infinity));
  }

  const columnsLabel = gKey ? `${mKey} grouped by ${gKey}` : mKey;
  return {
    result,
    metadata: meta(
      [mKey, gKey].filter(Boolean),
      data.length,
      `Computed ${aggType} of ${columnsLabel}, sorted descending`,
      null
    ),
  };
}

/**
 * Filter rows by applying an operator to a column value.
 * Operators: "equals" | "not_equals" | "gt" | "lt" | "gte" | "lte" |
 *            "contains" | "not_contains" | "between"
 * For "between", value should be [min, max].
 */
export function filter(data, column, operator, value) {
  if (!data || data.length === 0) return errResult("No data provided to filter.");

  const key = resolveCol(data, column);
  if (!key) return errResult(`Column "${column}" not found in dataset.`);

  const test = (cellVal) => {
    const str = String(cellVal ?? "").toLowerCase();
    const num = toNum(cellVal);
    const cmpNum = toNum(value);

    switch (operator) {
      case "equals":      return String(cellVal).toLowerCase() === String(value).toLowerCase();
      case "not_equals":  return String(cellVal).toLowerCase() !== String(value).toLowerCase();
      case "gt":          return !isNaN(num) && !isNaN(cmpNum) && num > cmpNum;
      case "lt":          return !isNaN(num) && !isNaN(cmpNum) && num < cmpNum;
      case "gte":         return !isNaN(num) && !isNaN(cmpNum) && num >= cmpNum;
      case "lte":         return !isNaN(num) && !isNaN(cmpNum) && num <= cmpNum;
      case "contains":    return str.includes(String(value).toLowerCase());
      case "not_contains":return !str.includes(String(value).toLowerCase());
      case "between": {
        const [lo, hi] = Array.isArray(value) ? value : [value, value];
        return !isNaN(num) && num >= toNum(lo) && num <= toNum(hi);
      }
      default:            return true;
    }
  };

  const result = data.filter((row) => test(row[key]));
  const filterDesc = `${key} ${operator} ${Array.isArray(value) ? value.join(" and ") : value}`;

  return {
    result,
    metadata: meta([key], data.length, `Filtered rows where ${filterDesc}`, filterDesc),
  };
}

/**
 * Sort rows by a column, ascending or descending.
 * Handles both numeric and string values correctly.
 */
export function sort(data, column, direction = "desc") {
  if (!data || data.length === 0) return errResult("No data provided to sort.");

  const key = resolveCol(data, column);
  if (!key) return errResult(`Column "${column}" not found in dataset.`);

  const result = [...data].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    const na = toNum(va);
    const nb = toNum(vb);

    // Both numeric
    if (!isNaN(na) && !isNaN(nb)) {
      return direction === "asc" ? na - nb : nb - na;
    }
    // String comparison
    const sa = String(va ?? "");
    const sb = String(vb ?? "");
    const cmp = sa.localeCompare(sb);
    return direction === "asc" ? cmp : -cmp;
  });

  return {
    result,
    metadata: meta([key], data.length, `Sorted by ${key} ${direction}`, null),
  };
}

/**
 * Return the top or bottom N rows by a metric column.
 * direction: "top" | "bottom"
 */
export function topN(data, metricCol, n = 5, direction = "top") {
  if (!data || data.length === 0) return errResult("No data provided to topN.");

  const key = resolveCol(data, metricCol);
  if (!key) return errResult(`Column "${metricCol}" not found in dataset.`);

  const sortDir = direction === "top" ? "desc" : "asc";
  const sorted = sort(data, key, sortDir);
  const result = sorted.result.slice(0, n);

  return {
    result,
    metadata: meta([key], data.length, `${direction === "top" ? "Top" : "Bottom"} ${n} rows by ${key}`, null),
  };
}

/* ═══════════════════════════════════════════════════════════
   §3  TREND ANALYSIS
═══════════════════════════════════════════════════════════ */

/**
 * Period-over-period trend analysis.
 * - Computes total metricCol per timeCol period (chronological order).
 * - Returns change and change% vs prior period for each time slot.
 * - If groupCol is provided, also does driver analysis: which groups drove the overall change.
 *
 * Returns rows of shape:
 *   { [timeCol], value, change, changePct, drivers?: [{ group, value, change, changePct }] }
 */
export function trend(data, timeCol, metricCol, groupCol = null) {
  if (!data || data.length === 0) return errResult("No data provided for trend analysis.");

  const tKey = resolveCol(data, timeCol);
  if (!tKey) return errResult(`Time column "${timeCol}" not found.`);

  const mKey = resolveCol(data, metricCol);
  if (!mKey) return errResult(`Metric column "${metricCol}" not found.`);

  const gKey = groupCol ? resolveCol(data, groupCol) : null;

  // Collect unique periods in chronological order
  const allPeriods = [...new Set(data.map((r) => String(r[tKey] ?? "")))];
  const periods = parseDateColumn(allPeriods);

  // Aggregate metric per period (+ per group if needed)
  const periodTotals = {};  // period → total
  const groupTotals  = {};  // period → { group → total }

  for (const row of data) {
    const p = String(row[tKey] ?? "");
    const v = toNum(row[mKey]);
    if (isNaN(v)) continue;

    periodTotals[p] = (periodTotals[p] ?? 0) + v;

    if (gKey) {
      const g = String(row[gKey] ?? "(blank)");
      if (!groupTotals[p]) groupTotals[p] = {};
      groupTotals[p][g] = (groupTotals[p][g] ?? 0) + v;
    }
  }

  const result = periods.map((period, i) => {
    const value = periodTotals[period] ?? 0;
    const prev  = i > 0 ? (periodTotals[periods[i - 1]] ?? 0) : null;
    const change    = prev !== null ? +(value - prev).toFixed(4) : null;
    const changePct = prev !== null && prev !== 0 ? +((change / prev) * 100).toFixed(2) : null;

    const row = { [tKey]: period, value: +value.toFixed(4), change, changePct };

    // Driver analysis
    if (gKey && i > 0) {
      const prevPeriod = periods[i - 1];
      const curGroups  = groupTotals[period]      ?? {};
      const prevGroups = groupTotals[prevPeriod]  ?? {};
      const allGroups  = new Set([...Object.keys(curGroups), ...Object.keys(prevGroups)]);

      const drivers = [...allGroups].map((g) => {
        const gCur  = curGroups[g]  ?? 0;
        const gPrev = prevGroups[g] ?? 0;
        const gChg  = +(gCur - gPrev).toFixed(4);
        const gPct  = gPrev !== 0 ? +((gChg / gPrev) * 100).toFixed(2) : null;
        return { group: g, value: +gCur.toFixed(4), change: gChg, changePct: gPct };
      });

      // Sort by absolute change descending
      drivers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      row.drivers = drivers;
    }

    return row;
  });

  const colsUsed = [tKey, mKey, gKey].filter(Boolean);
  const methodStr = gKey
    ? `Computed period-over-period trend of ${mKey} by ${tKey}, with driver analysis by ${gKey}`
    : `Computed period-over-period trend of ${mKey} by ${tKey}`;

  return {
    result,
    metadata: meta(colsUsed, data.length, methodStr, null),
  };
}

/* ═══════════════════════════════════════════════════════════
   §4  COMPARISON
═══════════════════════════════════════════════════════════ */

/**
 * Compare groups across one or more metric columns.
 * For each group: total and average per metric.
 * Includes pairwise diff/pct between groups, and flags the biggest gap.
 *
 * metricCols: string | string[]
 */
export function compare(data, groupCol, metricCols) {
  if (!data || data.length === 0) return errResult("No data provided to compare.");

  const gKey = resolveCol(data, groupCol);
  if (!gKey) return errResult(`Group column "${groupCol}" not found.`);

  const mKeys = []
    .concat(metricCols)
    .map((c) => resolveCol(data, c))
    .filter(Boolean);

  if (mKeys.length === 0) return errResult("No valid metric columns found.");

  // Bucket rows by group
  const buckets = {};
  for (const row of data) {
    const g = String(row[gKey] ?? "(blank)");
    if (!buckets[g]) buckets[g] = [];
    buckets[g].push(row);
  }

  // Compute per-group stats
  const groups = Object.entries(buckets).map(([group, rows]) => {
    const stats = {};
    for (const mk of mKeys) {
      const n = nums(rows.map((r) => r[mk]));
      stats[mk] = {
        total: n.length ? +n.reduce((s, x) => s + x, 0).toFixed(4) : null,
        avg:   n.length ? +(n.reduce((s, x) => s + x, 0) / n.length).toFixed(4) : null,
        count: rows.length,
      };
    }
    return { group, ...stats };
  });

  // Pairwise differences for each metric (for 2-group case, common in BI)
  const comparisons = [];
  if (groups.length >= 2) {
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const ga = groups[i];
        const gb = groups[j];
        for (const mk of mKeys) {
          const totalA = ga[mk]?.total;
          const totalB = gb[mk]?.total;
          if (totalA !== null && totalB !== null) {
            const diff = +(totalA - totalB).toFixed(4);
            const pct  = totalB !== 0 ? +((diff / totalB) * 100).toFixed(2) : null;
            comparisons.push({
              metricCol: mk,
              groupA: ga.group,
              groupB: gb.group,
              totalA,
              totalB,
              diff,
              diffPct: pct,
            });
          }
        }
      }
    }
    // Flag the biggest gap
    if (comparisons.length) {
      const maxGap = comparisons.reduce((best, c) =>
        Math.abs(c.diff) > Math.abs(best.diff) ? c : best
      );
      maxGap._biggestGap = true;
    }
  }

  return {
    result: { groups, comparisons },
    metadata: meta(
      [gKey, ...mKeys],
      data.length,
      `Compared groups by ${gKey} across metrics: ${mKeys.join(", ")}`,
      null
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §5  BREAKDOWN (share analysis)
═══════════════════════════════════════════════════════════ */

/**
 * Break metricCol down by groupCol, computing each group's share of the total.
 * Flags if any single group exceeds 50% (concentration alert).
 * Returns sorted by share descending.
 */
export function breakdown(data, metricCol, groupCol) {
  if (!data || data.length === 0) return errResult("No data for breakdown.");

  const mKey = resolveCol(data, metricCol);
  if (!mKey) return errResult(`Metric column "${metricCol}" not found.`);

  const gKey = resolveCol(data, groupCol);
  if (!gKey) return errResult(`Group column "${groupCol}" not found.`);

  const totals = {};
  for (const row of data) {
    const g = String(row[gKey] ?? "(blank)");
    const v = toNum(row[mKey]);
    if (!isNaN(v)) totals[g] = (totals[g] ?? 0) + v;
  }

  const grand = Object.values(totals).reduce((s, v) => s + v, 0);

  const result = Object.entries(totals)
    .map(([group, total]) => ({
      [gKey]: group,
      [mKey]: +total.toFixed(4),
      share: grand > 0 ? +(total / grand * 100).toFixed(2) : 0,
      concentrationAlert: grand > 0 && (total / grand) > 0.5,
    }))
    .sort((a, b) => b.share - a.share);

  const dominated = result.find((r) => r.concentrationAlert);

  return {
    result,
    metadata: meta(
      [mKey, gKey],
      data.length,
      `Broke down ${mKey} by ${gKey}; grand total ${formatNumber(grand)}${dominated ? ` — concentration alert: ${dominated[gKey]} exceeds 50%` : ""}`,
      null
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §6  ANOMALY DETECTION
═══════════════════════════════════════════════════════════ */

/**
 * Find values that deviate more than threshold% from the column mean.
 * Returns anomalous rows with their deviation percentage.
 * Default threshold: 20 (i.e., 20% from mean).
 */
export function anomaly(data, metricCol, threshold = 20) {
  if (!data || data.length === 0) return errResult("No data for anomaly detection.");

  const key = resolveCol(data, metricCol);
  if (!key) return errResult(`Column "${metricCol}" not found.`);

  const values = nums(data.map((r) => r[key]));
  if (values.length === 0) return errResult(`No numeric values in column "${metricCol}".`);

  const mean = values.reduce((s, v) => s + v, 0) / values.length;

  const result = data
    .map((row) => {
      const v = toNum(row[key]);
      if (isNaN(v)) return null;
      const deviationPct = mean !== 0 ? +((Math.abs(v - mean) / Math.abs(mean)) * 100).toFixed(2) : null;
      return { ...row, _mean: +mean.toFixed(4), _deviation: v - mean, _deviationPct: deviationPct };
    })
    .filter((row) => row && row._deviationPct !== null && row._deviationPct > threshold);

  result.sort((a, b) => Math.abs(b._deviationPct) - Math.abs(a._deviationPct));

  return {
    result,
    metadata: meta(
      [key],
      data.length,
      `Found ${result.length} anomalous values in ${key} (>${threshold}% deviation from mean ${formatNumber(mean)})`,
      `deviation > ${threshold}%`
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §7  CORRELATION
═══════════════════════════════════════════════════════════ */

/**
 * Compute Pearson correlation coefficient between two numeric columns.
 * Returns { coefficient, interpretation, col1, col2 }.
 */
export function correlation(data, col1, col2) {
  if (!data || data.length === 0) return errResult("No data for correlation.");

  const key1 = resolveCol(data, col1);
  const key2 = resolveCol(data, col2);
  if (!key1) return errResult(`Column "${col1}" not found.`);
  if (!key2) return errResult(`Column "${col2}" not found.`);

  // Paired non-null values
  const pairs = data
    .map((r) => [toNum(r[key1]), toNum(r[key2])])
    .filter(([a, b]) => !isNaN(a) && !isNaN(b));

  if (pairs.length < 2) return errResult("Not enough paired numeric values to compute correlation.");

  const n = pairs.length;
  const xs = pairs.map(([a]) => a);
  const ys = pairs.map(([, b]) => b);

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let num = 0, sumSqX = 0, sumSqY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num    += dx * dy;
    sumSqX += dx * dx;
    sumSqY += dy * dy;
  }

  const denom = Math.sqrt(sumSqX * sumSqY);
  const r = denom === 0 ? 0 : +(num / denom).toFixed(4);

  const abs = Math.abs(r);
  const dir = r > 0 ? "positive" : "negative";
  let strength;
  if (abs >= 0.9) strength = "very strong";
  else if (abs >= 0.7) strength = "strong";
  else if (abs >= 0.5) strength = "moderate";
  else if (abs >= 0.3) strength = "weak";
  else strength = "very weak / negligible";

  const interpretation = `${strength} ${dir} correlation`;

  return {
    result: [{ col1: key1, col2: key2, coefficient: r, interpretation, n }],
    metadata: meta(
      [key1, key2],
      data.length,
      `Computed Pearson correlation between ${key1} and ${key2}: r=${r} (${interpretation})`,
      null
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §8  COMPUTED METRICS
═══════════════════════════════════════════════════════════ */

/**
 * Recursively evaluate a formula against a row object.
 * Supported operations: add | subtract | multiply | divide | ratio
 * A formula node is either:
 *   - a string (column name)
 *   - { operation: "subtract"|"add"|"multiply"|"divide"|"ratio", left/right or numerator/denominator }
 *   - { operation: "ratio", numerator: node, denominator: node } (alias for divide)
 */
function evalFormula(formula, row) {
  if (typeof formula === "string") {
    const key = Object.keys(row).find((k) => k.toLowerCase() === formula.toLowerCase());
    return key !== undefined ? toNum(row[key]) : NaN;
  }
  if (typeof formula !== "object") return NaN;

  const { operation } = formula;

  switch (operation) {
    case "add": {
      const l = evalFormula(formula.left, row);
      const r = evalFormula(formula.right, row);
      return isNaN(l) || isNaN(r) ? NaN : l + r;
    }
    case "subtract": {
      const l = evalFormula(formula.left, row);
      const r = evalFormula(formula.right, row);
      return isNaN(l) || isNaN(r) ? NaN : l - r;
    }
    case "multiply": {
      const l = evalFormula(formula.left, row);
      const r = evalFormula(formula.right, row);
      return isNaN(l) || isNaN(r) ? NaN : l * r;
    }
    case "divide":
    case "ratio": {
      const n = evalFormula(formula.numerator, row);
      const d = evalFormula(formula.denominator, row);
      return isNaN(n) || isNaN(d) || d === 0 ? NaN : n / d;
    }
    default:
      return NaN;
  }
}

/**
 * Collect all leaf column names referenced in a formula (for metadata).
 */
function formulaColumns(formula) {
  if (typeof formula === "string") return [formula];
  if (typeof formula !== "object") return [];
  const { left, right, numerator, denominator } = formula;
  return [
    ...(left        ? formulaColumns(left)        : []),
    ...(right       ? formulaColumns(right)       : []),
    ...(numerator   ? formulaColumns(numerator)   : []),
    ...(denominator ? formulaColumns(denominator) : []),
  ];
}

/**
 * Apply a computed formula per-row, then optionally group + sum by groupCol.
 * formula: see evalFormula above.
 * resultName: the name to give the computed column.
 */
export function computeMetric(data, formula, resultName, groupCol = null) {
  if (!data || data.length === 0) return errResult("No data for computeMetric.");

  const gKey = groupCol ? resolveCol(data, groupCol) : null;

  // Compute per-row
  const withMetric = data.map((row) => ({
    ...row,
    [resultName]: (() => {
      const v = evalFormula(formula, row);
      return isNaN(v) ? null : +v.toFixed(6);
    })(),
  }));

  let result = withMetric;

  // If groupCol: aggregate (sum) the computed metric per group
  if (gKey) {
    const groups = {};
    for (const row of withMetric) {
      const g = String(row[gKey] ?? "(blank)");
      if (!groups[g]) groups[g] = [];
      if (row[resultName] !== null) groups[g].push(row[resultName]);
    }
    result = Object.entries(groups)
      .map(([g, vals]) => ({
        [gKey]: g,
        [resultName]: vals.length ? +(vals.reduce((s, v) => s + v, 0)).toFixed(4) : null,
        _count: vals.length,
      }))
      .sort((a, b) => (b[resultName] ?? -Infinity) - (a[resultName] ?? -Infinity));
  }

  const leafCols = formulaColumns(formula);
  const methodParts = typeof formula === "object"
    ? `Computed ${resultName} = (${leafCols.join(` ${formula.operation} `)})`
    : `Computed ${resultName} from "${formula}"`;

  return {
    result,
    metadata: meta(
      [...leafCols, gKey].filter(Boolean),
      data.length,
      methodParts + (gKey ? `, aggregated by ${gKey}` : ", applied per row"),
      null
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §9  JOIN DATASETS
═══════════════════════════════════════════════════════════ */

/**
 * Inner join two datasets on a shared column. Case-insensitive column name matching.
 * Returns merged rows for every matched pair.
 */
export function joinDatasets(data1, data2, joinCol) {
  if (!data1 || data1.length === 0) return errResult("First dataset is empty.");
  if (!data2 || data2.length === 0) return errResult("Second dataset is empty.");

  const key1 = resolveCol(data1, joinCol);
  const key2 = resolveCol(data2, joinCol);

  if (!key1) return errResult(`Join column "${joinCol}" not found in first dataset.`);
  if (!key2) return errResult(`Join column "${joinCol}" not found in second dataset.`);

  // Build index on data2
  const index = {};
  for (const row of data2) {
    const k = String(row[key2] ?? "").toLowerCase();
    if (!index[k]) index[k] = [];
    index[k].push(row);
  }

  const result = [];
  for (const row1 of data1) {
    const k = String(row1[key1] ?? "").toLowerCase();
    const matches = index[k] ?? [];
    for (const row2 of matches) {
      // Merge, with data1's keys taking precedence for conflicts
      const merged = { ...row2, ...row1 };
      result.push(merged);
    }
  }

  return {
    result,
    metadata: meta(
      [key1],
      data1.length + data2.length,
      `Inner-joined datasets on column "${key1}" — ${result.length} matched rows`,
      `join on ${key1}`
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §9b  RANK COLUMNS  (columns-as-series comparison)
═══════════════════════════════════════════════════════════ */

/**
 * Sum a list of named columns across all rows and return them ranked.
 * Purpose: answers "which quarter/metric was highest/lowest" when the values
 * to compare are spread across COLUMNS rather than ROWS.
 *
 * Example: Q1=94000, Q2=123700, Q3=102300, Q4=105500 → sorted desc
 *
 * @param {object[]}  data       — row array
 * @param {string[]}  columns    — column names to compare (e.g. ["Q1","Q2","Q3","Q4"])
 * @param {"top"|"bottom"} direction — "top" = highest first (default)
 * @returns standard envelope with result = [{ name, total, rank }]
 */
export function rankColumns(data, columns, direction = "top") {
  if (!data || data.length === 0) return errResult("No data for column ranking.");
  if (!columns || columns.length === 0) return errResult("No columns specified for ranking.");

  const resolved = columns
    .map((c) => ({ orig: c, key: resolveCol(data, c) }))
    .filter((c) => c.key !== null);

  if (resolved.length === 0) {
    return errResult(`None of the columns [${columns.join(", ")}] were found in the dataset.`);
  }

  // Sum each column across all rows
  const totals = resolved.map(({ orig, key }) => {
    const total = data.reduce((sum, row) => {
      const v = toNum(row[key]);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
    return { name: orig, total: +total.toFixed(2) };
  });

  // Sort
  const sorted = [...totals].sort((a, b) =>
    direction === "top" ? b.total - a.total : a.total - b.total
  );

  const result = sorted.map((item, i) => ({ ...item, rank: i + 1 }));

  return {
    result,
    metadata: meta(
      resolved.map((c) => c.key),
      data.length,
      `Ranked ${resolved.length} columns by total (${direction}): ${sorted.map((c) => `${c.name}=${c.total}`).join(", ")}`,
      null
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §10  SUMMARIZE
═══════════════════════════════════════════════════════════ */

/**
 * Generate a quick summary for each specified column.
 * - numeric: latest, mean, min, max, trend vs prior (if date col exists)
 * - categorical: most frequent value
 *
 * columns: string | string[]  — column names to summarize
 */
export function summarize(data, columns) {
  if (!data || data.length === 0) return errResult("No data to summarize.");

  const colList = [].concat(columns);
  if (colList.length === 0) return errResult("No columns specified for summarise.");

  // Detect if there's a date column (first date-like column in the row keys)
  const allKeys = Object.keys(data[0]);
  const dateKey = allKeys.find((k) => {
    const sample = data.slice(0, 5).map((r) => String(r[k] ?? ""));
    return sample.some((v) => /^(W\d|Q[1-4]|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(v));
  });

  const result = colList.map((colName) => {
    const key = resolveCol(data, colName);
    if (!key) return { column: colName, error: "Column not found" };

    const values = data.map((r) => r[key]);
    const numVals = nums(values);

    // Categorical
    if (numVals.length === 0) {
      const freq = {};
      for (const v of values.filter(Boolean)) freq[String(v)] = (freq[String(v)] ?? 0) + 1;
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      return { column: key, type: "categorical", topValue: top ? top[0] : null, uniqueCount: Object.keys(freq).length };
    }

    const mean = numVals.reduce((s, v) => s + v, 0) / numVals.length;
    const min  = Math.min(...numVals);
    const max  = Math.max(...numVals);

    // Latest vs previous using date column
    let latest = null, previous = null, trendPct = null;
    if (dateKey) {
      const periods = parseDateColumn([...new Set(data.map((r) => String(r[dateKey] ?? "")))]);
      if (periods.length >= 2) {
        const latestRows   = data.filter((r) => String(r[dateKey]) === periods[periods.length - 1]);
        const previousRows = data.filter((r) => String(r[dateKey]) === periods[periods.length - 2]);
        const sumOf = (rows) => nums(rows.map((r) => r[key])).reduce((s, v) => s + v, 0);
        latest   = sumOf(latestRows);
        previous = sumOf(previousRows);
        trendPct = previous !== 0 ? +((latest - previous) / previous * 100).toFixed(2) : null;
      }
    }

    return {
      column: key,
      type: "numeric",
      latest: latest !== null ? +latest.toFixed(4) : null,
      previous: previous !== null ? +previous.toFixed(4) : null,
      trendPct,
      mean: +mean.toFixed(4),
      min: +min.toFixed(4),
      max: +max.toFixed(4),
    };
  });

  return {
    result,
    metadata: meta(
      colList,
      data.length,
      `Summarised columns: ${colList.join(", ")}`,
      null
    ),
  };
}

/* ═══════════════════════════════════════════════════════════
   §11  TEXT OPERATIONS
═══════════════════════════════════════════════════════════ */

const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","to","of","in","for","and","or","but","with",
  "on","at","by","from","as","it","its","this","that","we","our","their","be","been",
  "has","have","had","not","they","will","do","did","about","which","who","more","than",
  "so","up","out","if","about","into","then","there","when","all","my","your","i","he",
  "she","they","us","am","can","could","would","should","no","yes","just","also","very",
  "now","over","after","before","during","between","since","through","against","too",
]);

const POSITIVE_WORDS = [
  "improved","great","excellent","satisfied","satisfaction","fast","resolved","happy",
  "happiness","growth","increased","increase","better","best","outstanding","positive",
  "success","successful","quality","efficient","smooth","effective","strong","good",
];

const NEGATIVE_WORDS = [
  "complained","complaint","delayed","delay","poor","slow","declined","decline","dropped",
  "drop","frustrated","frustration","issue","problem","decreased","decrease","bug","error",
  "bad","failed","failure","worst","terrible","awful","broken","damaged","late","refund",
  "defective","disappointed","disappointing",
];

/**
 * Case-insensitive keyword search across a text column.
 * Splits query into words, finds rows where ANY word matches.
 * Returns matching rows with matched terms and match count.
 */
export function searchText(data, textCol, query) {
  if (!data || data.length === 0) return errResult("No data for text search.");

  const key = resolveCol(data, textCol);
  if (!key) return errResult(`Text column "${textCol}" not found.`);
  if (!query || !query.trim()) return errResult("Search query is empty.");

  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  const result = data
    .map((row) => {
      const cellText = String(row[key] ?? "").toLowerCase();
      const matched  = queryWords.filter((w) => cellText.includes(w));
      if (matched.length === 0) return null;

      // Bold-mark matched terms in the original text
      let highlighted = String(row[key] ?? "");
      for (const w of matched) {
        const re = new RegExp(`(${w})`, "gi");
        highlighted = highlighted.replace(re, "**$1**");
      }

      return { ...row, _highlighted: highlighted, _matchedTerms: matched, _matchCount: matched.length };
    })
    .filter(Boolean);

  return {
    result,
    metadata: meta(
      [key],
      data.length,
      `Searched "${key}" for keywords: ${queryWords.join(", ")} — found ${result.length} matching rows`,
      `query: "${query}"`
    ),
  };
}

/**
 * Extract top keywords and theme clusters from a text column.
 * Returns top 15 keywords by frequency and loose theme clusters.
 */
export function extractThemes(data, textCol) {
  if (!data || data.length === 0) return errResult("No data for theme extraction.");

  const key = resolveCol(data, textCol);
  if (!key) return errResult(`Text column "${textCol}" not found.`);

  // Word frequency
  const freq = {};
  for (const row of data) {
    const words = String(row[key] ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));

    for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  }

  const topKeywords = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));

  // Theme clustering: group rows that share at least one top-keyword
  const topWords = new Set(topKeywords.map((t) => t.word));
  const clusters = {};

  for (const row of data) {
    const text = String(row[key] ?? "").toLowerCase();
    const matched = [...topWords].filter((w) => text.includes(w));
    if (matched.length === 0) continue;

    // Assign to cluster of first matched keyword
    const clusterKey = matched[0];
    if (!clusters[clusterKey]) clusters[clusterKey] = { theme: clusterKey, relatedWords: new Set(), rows: [] };
    matched.forEach((w) => clusters[clusterKey].relatedWords.add(w));
    clusters[clusterKey].rows.push(row);
  }

  const themeClusters = Object.values(clusters).map((c) => ({
    theme: c.theme,
    keywords: [...c.relatedWords].slice(0, 5),
    count: c.rows.length,
    rows: c.rows,
  })).sort((a, b) => b.count - a.count);

  return {
    result: { topKeywords, themeClusters },
    metadata: meta(
      [key],
      data.length,
      `Extracted top ${topKeywords.length} keywords and ${themeClusters.length} theme clusters from "${key}"`,
      null
    ),
  };
}

/**
 * Basic keyword-based sentiment scoring per row.
 * Returns { positive, negative, neutral } counts and rows grouped by sentiment.
 * If groupCol is provided, also breaks down sentiment per group and
 * returns groupRanking sorted worst→best (for "which month had worst feedback").
 */
export function sentimentScan(data, textCol, groupCol = null) {
  if (!data || data.length === 0) return errResult("No data for sentiment analysis.");

  const key = resolveCol(data, textCol);
  if (!key) return errResult(`Text column "${textCol}" not found.`);

  const groupKey = groupCol ? resolveCol(data, groupCol) : null;

  const groups = { positive: [], negative: [], neutral: [] };
  let posCount = 0, negCount = 0, neutralCount = 0;

  const groupStats = {};

  for (const row of data) {
    const text  = String(row[key] ?? "").toLowerCase();
    const pos   = POSITIVE_WORDS.filter((w) => text.includes(w));
    const neg   = NEGATIVE_WORDS.filter((w) => text.includes(w));
    const score = pos.length - neg.length;

    let sentiment;
    if (score > 0)      { sentiment = "positive"; posCount++; }
    else if (score < 0) { sentiment = "negative"; negCount++; }
    else                { sentiment = "neutral";  neutralCount++; }

    const enrichedRow = { ...row, _sentiment: sentiment, _positiveMatches: pos, _negativeMatches: neg, _score: score };
    groups[sentiment].push(enrichedRow);

    if (groupKey) {
      const gVal = String(row[groupKey] ?? "Unknown");
      if (!groupStats[gVal]) {
        groupStats[gVal] = { group: gVal, positive: 0, negative: 0, neutral: 0, total: 0, netScore: 0 };
      }
      groupStats[gVal][sentiment]++;
      groupStats[gVal].total++;
      groupStats[gVal].netScore += score;
    }
  }

  // Sort worst→best (most negative net score first)
  const groupRanking = groupKey
    ? Object.values(groupStats)
        .sort((a, b) => a.netScore - b.netScore)
        .map((g) => ({
          ...g,
          negativeRate: g.total > 0 ? Math.round((g.negative / g.total) * 100) : 0,
          positiveRate: g.total > 0 ? Math.round((g.positive / g.total) * 100) : 0,
        }))
    : null;

  return {
    result: {
      counts: { positive: posCount, negative: negCount, neutral: neutralCount, total: data.length },
      groups,
      groupRanking,
    },
    metadata: meta(
      [key, ...(groupKey ? [groupKey] : [])].filter(Boolean),
      data.length,
      `Scanned ${data.length} entries for sentiment in "${key}"${groupKey ? ` grouped by "${groupKey}"` : ""} — ${posCount} positive, ${negCount} negative, ${neutralCount} neutral`,
      null
    ),
  };
}
