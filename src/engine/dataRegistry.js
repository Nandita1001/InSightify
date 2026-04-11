/**
 * dataRegistry.js — Data Analysis Engine: Registry Layer
 *
 * Responsibilities:
 *  1. On import, register the 3 built-in company datasets (Sales, Customer Behavior, Financial Reports)
 *     with hand-crafted column metadata (name, type, description) merged with auto-computed stats.
 *  2. Expose profileData(rows) — auto-detects column types and computes stats for any row array.
 *  3. Expose registerCSV(file) — parses an uploaded CSV with Papaparse, profiles it, and adds it
 *     to the live registry. Returns a Promise<registryEntry>.
 *  4. Expose getRegistry() / getDataset(id) for read access.
 *
 * Registry entry shape:
 *   {
 *     id: string,
 *     name: string,
 *     description: string,
 *     rowCount: number,
 *     columns: [{ name, type, description, stats }],
 *     data: [...rows]
 *   }
 *
 * Column types: "numeric" | "categorical" | "date" | "text"
 *
 * Stats shape per type:
 *   numeric:     { min, max, mean, median, stdDev, nullCount, uniqueCount }
 *   categorical: { uniqueCount, nullCount, topValues: [{ value, count }] }
 *   date:        { min, max, nullCount, uniqueCount }
 *   text:        { nullCount, uniqueCount, avgLength, sample: [string] }
 */

import Papa from "papaparse";
import { sampleSales } from "../../data/sampleSales.js";
import { sampleCustomers } from "../../data/sampleCustomers.js";
import { sampleCosts } from "../../data/sampleCosts.js";
import { sampleFeedback } from "../../data/sampleFeedback.js";

/* ─────────────────────────────────────────────
   TYPE DETECTION HELPERS
───────────────────────────────────────────── */

/**
 * Determine whether a raw value looks like a number.
 * Handles JS numbers, numeric strings, and empty/null (treated as null, not numeric).
 */
function isNumericValue(v) {
  if (v === null || v === undefined || v === "") return false;
  return !isNaN(Number(v));
}

/**
 * Determine whether a raw value looks like a date string.
 * We look for ISO-8601 patterns, month-name patterns, and slash/dash separated dates.
 */
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}/, // ISO 8601
  /^\d{1,2}\/\d{1,2}\/\d{2,4}/, // MM/DD/YYYY
  /^\d{1,2}-\d{1,2}-\d{2,4}/, // DD-MM-YYYY
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i, // "Jan 2024"
  /^W\d+ (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i, // "W1 Jan"
  /^Q[1-4] \d{4}$/i, // "Q1 2024"
];

function isDateValue(v) {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v !== "string") return false;
  return DATE_PATTERNS.some((re) => re.test(String(v).trim()));
}

/**
 * Infer the dominant type of a column from its values.
 * Strategy: sample all non-null values, vote on type.
 * Priority: numeric > date > categorical (short strings) > text (long strings)
 */
function inferColumnType(values) {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "text";

  const numericVotes = nonNull.filter(isNumericValue).length;
  const dateVotes = nonNull.filter(isDateValue).length;

  const numericRatio = numericVotes / nonNull.length;
  const dateRatio = dateVotes / nonNull.length;

  if (numericRatio >= 0.8) return "numeric";
  if (dateRatio >= 0.6) return "date";

  // categorical vs text: if avg string length < 30 and unique ratio < 0.8, it's categorical
  const strValues = nonNull.map((v) => String(v));
  const avgLen = strValues.reduce((s, v) => s + v.length, 0) / strValues.length;
  const uniqueRatio = new Set(strValues).size / strValues.length;

  if (avgLen <= 30 && uniqueRatio <= 0.85) return "categorical";
  return "text";
}

/* ─────────────────────────────────────────────
   STATS COMPUTATION
───────────────────────────────────────────── */

function computeNumericStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nums = values
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map(Number)
    .sort((a, b) => a - b);

  if (nums.length === 0) return { min: null, max: null, mean: null, median: null, stdDev: null, nullCount, uniqueCount: 0 };

  const min = nums[0];
  const max = nums[nums.length - 1];
  const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
  const median =
    nums.length % 2 === 0
      ? (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
      : nums[Math.floor(nums.length / 2)];
  const variance = nums.reduce((s, n) => s + Math.pow(n - mean, 2), 0) / nums.length;
  const stdDev = Math.sqrt(variance);
  const uniqueCount = new Set(nums).size;

  return {
    min: +min.toFixed(4),
    max: +max.toFixed(4),
    mean: +mean.toFixed(4),
    median: +median.toFixed(4),
    stdDev: +stdDev.toFixed(4),
    nullCount,
    uniqueCount,
  };
}

function computeCategoricalStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  const freq = {};
  for (const v of nonNull) freq[v] = (freq[v] || 0) + 1;

  const topValues = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([value, count]) => ({ value, count }));

  return {
    uniqueCount: new Set(nonNull).size,
    nullCount,
    topValues,
  };
}

function computeDateStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  return {
    min: nonNull[0] ?? null,
    max: nonNull[nonNull.length - 1] ?? null,
    nullCount,
    uniqueCount: new Set(nonNull).size,
  };
}

function computeTextStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  const avgLength =
    nonNull.length > 0
      ? +(nonNull.reduce((s, v) => s + v.length, 0) / nonNull.length).toFixed(1)
      : 0;
  return {
    nullCount,
    uniqueCount: new Set(nonNull).size,
    avgLength,
    sample: nonNull.slice(0, 3),
  };
}

/* ─────────────────────────────────────────────
   COLUMN PROFILER
───────────────────────────────────────────── */

/**
 * Profile a single column extracted from rows.
 * @param {string} colName
 * @param {any[]} values  — one value per row
 * @param {object} [hint] — optional { description } for known columns
 * @returns {{ name, type, description, stats }}
 */
function profileColumn(colName, values, hint = {}) {
  const type = inferColumnType(values);
  let stats;

  switch (type) {
    case "numeric":
      stats = computeNumericStats(values);
      break;
    case "categorical":
      stats = computeCategoricalStats(values);
      break;
    case "date":
      stats = computeDateStats(values);
      break;
    case "text":
    default:
      stats = computeTextStats(values);
      break;
  }

  return {
    name: colName,
    type,
    description: hint.description ?? "",
    stats,
  };
}

/**
 * Auto-profile an array of row objects.
 * Extracts all column names from the first row, then profiles each.
 * @param {object[]} rows
 * @param {Record<string, { description?: string }>} [columnHints]
 * @returns {{ name, type, description, stats }[]}
 */
export function profileData(rows, columnHints = {}) {
  if (!rows || rows.length === 0) return [];

  const colNames = Object.keys(rows[0]);
  return colNames.map((col) => {
    const values = rows.map((r) => r[col] ?? null);
    return profileColumn(col, values, columnHints[col] ?? {});
  });
}

/* ─────────────────────────────────────────────
   COMPANY DATASET COLUMN HINTS
   (hand-crafted descriptions for each known column)
───────────────────────────────────────────── */

const SALES_HINTS = {
  month:    { description: "Month of the sales period (Jan–Jun)" },
  region:   { description: "Sales region: North, South, East, West" },
  product:  { description: "Product sold: Widget A, B, or C" },
  channel:  { description: "Sales channel: Online, Retail, or Wholesale" },
  revenue:  { description: "Total revenue generated (USD)" },
  units:    { description: "Number of units sold" },
  cost:     { description: "Total cost of goods sold (USD)" },
  returns:  { description: "Number of product returns" },
  ad_spend: { description: "Advertising spend for the period (USD)" },
};

const CUSTOMERS_HINTS = {
  week:            { description: "Week label (e.g. W1 Jan)" },
  signups:         { description: "New customer sign-ups in the week" },
  churn:           { description: "Number of customers who churned" },
  active_users:    { description: "Total active users at week end" },
  avg_handle_time: { description: "Average support handle time in seconds" },
  nps:             { description: "Net Promoter Score (-100 to 100)" },
  tickets:         { description: "Support tickets opened" },
  resolution_rate: { description: "Percentage of tickets resolved (%)" },
  channel:         { description: "Primary customer channel: App, Web, or Phone" },
};

const COSTS_HINTS = {
  department: { description: "Business department name" },
  category:   { description: "Expense category (Salaries, Ad Spend, etc.)" },
  Q1:         { description: "Q1 spend (USD)" },
  Q2:         { description: "Q2 spend (USD)" },
  Q3:         { description: "Q3 spend (USD)" },
  Q4:         { description: "Q4 spend (USD)" },
  headcount:  { description: "Number of employees in the department" },
};

const FEEDBACK_HINTS = {
  date:   { description: "Month the feedback was received" },
  region: { description: "Region the feedback pertains to" },
  text:   { description: "Free-text customer feedback" },
};

/* ─────────────────────────────────────────────
   REGISTRY — in-memory store
───────────────────────────────────────────── */

/** @type {Map<string, object>} */
const _registry = new Map();

/**
 * Add an entry to the registry.
 * @param {{ id, name, description, data, columns }} entry
 */
function _register(entry) {
  _registry.set(entry.id, entry);
}

/* ─────────────────────────────────────────────
   BOOTSTRAP — register the 3 company datasets
───────────────────────────────────────────── */

function _bootstrap() {
  // 1. Sales Performance
  _register({
    id: "sales_performance",
    name: "Sales Performance",
    description: "Monthly sales data across all regions and product lines",
    source: "company",
    rowCount: sampleSales.length,
    columns: profileData(sampleSales, SALES_HINTS),
    data: sampleSales,
  });

  // 2. Customer Behavior
  _register({
    id: "customer_behavior",
    name: "Customer Behavior",
    description: "User engagement metrics and conversion funnels",
    source: "company",
    rowCount: sampleCustomers.length,
    columns: profileData(sampleCustomers, CUSTOMERS_HINTS),
    data: sampleCustomers,
  });

  // 3. Financial Reports (costs + feedback merged as a single "Financial Reports" dataset)
  //    sampleCosts is the main cost table; sampleFeedback is qualitative context.
  _register({
    id: "financial_reports",
    name: "Financial Reports",
    description: "Quarterly revenue, expenses, and profit margins",
    source: "company",
    rowCount: sampleCosts.length,
    columns: profileData(sampleCosts, COSTS_HINTS),
    data: sampleCosts,
  });

  // 4. Register feedback as its own entry (bonus — useful for text queries)
  _register({
    id: "customer_feedback",
    name: "Customer Feedback",
    description: "Qualitative customer feedback by region and month",
    source: "company",
    rowCount: sampleFeedback.length,
    columns: profileData(sampleFeedback, FEEDBACK_HINTS),
    data: sampleFeedback,
  });
}

// Run bootstrap immediately on module load
_bootstrap();

/* ─────────────────────────────────────────────
   PUBLIC API
───────────────────────────────────────────── */

/**
 * Return all registered datasets as an array.
 * @returns {object[]}
 */
export function getRegistry() {
  return Array.from(_registry.values());
}

/**
 * Return a single dataset by id, or undefined.
 * @param {string} id
 * @returns {object | undefined}
 */
export function getDataset(id) {
  return _registry.get(id);
}

/**
 * Find a dataset by name (case-insensitive substring match).
 * Returns the first match or undefined.
 * @param {string} name
 * @returns {object | undefined}
 */
export function findDatasetByName(name) {
  const needle = name.toLowerCase();
  for (const entry of _registry.values()) {
    if (entry.name.toLowerCase().includes(needle)) return entry;
  }
  return undefined;
}

/**
 * Parse and register an uploaded CSV File object.
 * Auto-profiles all columns and adds the dataset to the registry.
 *
 * @param {File} file  — browser File object from <input type="file">
 * @param {{ name?: string, description?: string }} [meta] — optional overrides
 * @returns {Promise<object>}  — the new registry entry
 */
export function registerCSV(file, meta = {}) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,       // use first row as column names
      skipEmptyLines: true,
      dynamicTyping: true, // auto-convert numerics
      complete(result) {
        if (result.errors.length > 0) {
          // Non-fatal: log and continue with what was parsed
          console.warn("[dataRegistry] CSV parse warnings:", result.errors);
        }

        const rows = result.data;
        if (rows.length === 0) {
          return reject(new Error("CSV file is empty or has no parseable rows."));
        }

        const id = `upload_${Date.now()}`;
        const name = meta.name ?? file.name.replace(/\.[^.]+$/, ""); // strip extension
        const description = meta.description ?? `Uploaded dataset from ${file.name}`;

        const entry = {
          id,
          name,
          description,
          rowCount: rows.length,
          columns: profileData(rows), // no hints for user uploads — fully auto
          data: rows,
          uploadedAt: new Date().toISOString(),
          fileName: file.name,
        };

        _register(entry);
        resolve(entry);
      },
      error(err) {
        reject(new Error(`CSV parse failed: ${err.message}`));
      },
    });
  });
}

/**
 * Remove a dataset from the registry by id.
 * Safe to call with a non-existent id.
 * @param {string} id
 */
export function removeDataset(id) {
  _registry.delete(id);
}

/**
 * Utility: get a quick summary of a dataset for display (no raw data).
 * @param {string} id
 * @returns {object | undefined}
 */
export function getDatasetSummary(id) {
  const entry = _registry.get(id);
  if (!entry) return undefined;
  const { data: _data, ...rest } = entry; // eslint-disable-line no-unused-vars
  return rest;
}
