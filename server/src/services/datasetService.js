/**
 * datasetService — built-in dataset seeding + user CSV upload + read API.
 *
 * The 4 company datasets (sales, customers, costs, feedback) are seeded
 * once on first boot. User uploads land via Multer and are profiled +
 * persisted with `source: "user"` and `ownerId` of the uploading user.
 */

import Papa from "papaparse";

import { Dataset } from "../models/Dataset.js";
import { DocumentChunk } from "../models/DocumentChunk.js";
import { ApiError } from "../utils/ApiError.js";
import { embedBatch } from "./embeddingService.js";

import { sampleSales }     from "../data/sampleSales.js";
import { sampleCustomers } from "../data/sampleCustomers.js";
import { sampleCosts }     from "../data/sampleCosts.js";
import { sampleFeedback }  from "../data/sampleFeedback.js";

/* ═══════════════════════════════════════════════════════════
   §1  COLUMN PROFILING  (ported from client dataRegistry.js)
═══════════════════════════════════════════════════════════ */

function isNumericValue(v) {
  if (v === null || v === undefined || v === "") return false;
  return !isNaN(Number(v));
}

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}/,
  /^\d{1,2}-\d{1,2}-\d{2,4}/,
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
  /^W\d+ (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
  /^Q[1-4] \d{4}$/i,
];

function isDateValue(v) {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v !== "string") return false;
  return DATE_PATTERNS.some((re) => re.test(v.trim()));
}

function inferColumnType(values) {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "text";

  const numericRatio = nonNull.filter(isNumericValue).length / nonNull.length;
  const dateRatio    = nonNull.filter(isDateValue).length / nonNull.length;

  if (numericRatio >= 0.8) return "numeric";
  if (dateRatio >= 0.6) return "date";

  const strs = nonNull.map((v) => String(v));
  const avgLen = strs.reduce((s, v) => s + v.length, 0) / strs.length;
  const uniqueRatio = new Set(strs).size / strs.length;
  if (avgLen <= 30 && uniqueRatio <= 0.85) return "categorical";
  return "text";
}

function computeNumericStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nums = values.filter((v) => v !== null && v !== undefined && v !== "").map(Number).sort((a, b) => a - b);
  if (nums.length === 0) return { min: null, max: null, mean: null, median: null, stdDev: null, nullCount, uniqueCount: 0 };
  const min = nums[0], max = nums[nums.length - 1];
  const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
  const median = nums.length % 2 === 0
    ? (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2
    : nums[Math.floor(nums.length / 2)];
  const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  return {
    min: +min.toFixed(4),
    max: +max.toFixed(4),
    mean: +mean.toFixed(4),
    median: +median.toFixed(4),
    stdDev: +Math.sqrt(variance).toFixed(4),
    nullCount,
    uniqueCount: new Set(nums).size,
  };
}

function computeCategoricalStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  const freq = {};
  for (const v of nonNull) freq[v] = (freq[v] || 0) + 1;
  const topValues = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, count]) => ({ value, count }));
  return { uniqueCount: new Set(nonNull).size, nullCount, topValues };
}

function computeDateStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  return { min: nonNull[0] ?? null, max: nonNull[nonNull.length - 1] ?? null, nullCount, uniqueCount: new Set(nonNull).size };
}

function computeTextStats(values) {
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "").map(String);
  const avgLength = nonNull.length > 0
    ? +(nonNull.reduce((s, v) => s + v.length, 0) / nonNull.length).toFixed(1)
    : 0;
  return { nullCount, uniqueCount: new Set(nonNull).size, avgLength, sample: nonNull.slice(0, 3) };
}

function profileColumn(name, values, hint = {}) {
  const type = inferColumnType(values);
  const stats =
    type === "numeric"     ? computeNumericStats(values) :
    type === "categorical" ? computeCategoricalStats(values) :
    type === "date"        ? computeDateStats(values) :
                             computeTextStats(values);
  return { name, type, description: hint.description ?? "", stats };
}

export function profileRows(rows, hints = {}) {
  if (!rows || rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  return cols.map((c) => profileColumn(c, rows.map((r) => r[c] ?? null), hints[c] ?? {}));
}

/* ═══════════════════════════════════════════════════════════
   §2  BUILT-IN DATASET DEFINITIONS  (column hints + seed)
═══════════════════════════════════════════════════════════ */

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

const BUILTINS = [
  { name: "Sales Performance",  description: "Monthly sales data across all regions and product lines",   rows: sampleSales,     hints: SALES_HINTS,     type: "structured" },
  { name: "Customer Behavior",  description: "User engagement metrics and conversion funnels",            rows: sampleCustomers, hints: CUSTOMERS_HINTS, type: "structured" },
  { name: "Financial Reports",  description: "Quarterly revenue, expenses, and profit margins",           rows: sampleCosts,     hints: COSTS_HINTS,     type: "structured" },
  { name: "Customer Feedback",  description: "Qualitative customer feedback by region and month",         rows: sampleFeedback,  hints: FEEDBACK_HINTS,  type: "structured" },
];

/**
 * Idempotent seeder: creates any missing built-in datasets.
 * Safe to run on every server boot.
 */
export async function seedBuiltIns() {
  for (const def of BUILTINS) {
    try {
      const existing = await Dataset.findOne({ source: "company", name: def.name });
      if (existing) continue;
      await Dataset.create({
        name:        def.name,
        description: def.description,
        source:      "company",
        type:        def.type,
        ownerId:     null,
        rowCount:    def.rows.length,
        columns:     profileRows(def.rows, def.hints),
        rows:        def.rows,
      });
      console.log(`[datasets] seeded built-in: ${def.name}`);
    } catch (err) {
      // Don't let a single transient Atlas error abort seeding the rest.
      console.warn(`[datasets] skipped "${def.name}" — ${err.message}`);
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   §3  PUBLIC SERVICE API
═══════════════════════════════════════════════════════════ */

const MAX_UPLOAD_ROWS = 100_000;
const MAX_CHUNK_CHARS = 1500;

/**
 * Convert one row of an unstructured dataset into the text we'll embed.
 * Mirrors the original `formatUnstructuredRows` join so what we embed is what
 * the LLM also sees in the augmented prompt.
 */
function rowToChunkText(row) {
  return Object.entries(row ?? {})
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join(" | ")
    .slice(0, MAX_CHUNK_CHARS);
}

/**
 * Embed every row of an unstructured dataset and persist as DocumentChunk
 * records. Sequential embedding keeps memory predictable; batches of ~100
 * inserts at a time keep Mongo writes flowing.
 */
async function ingestChunksForDataset(doc) {
  const rows = doc.rows ?? [];
  if (rows.length === 0) return 0;

  const texts = rows.map(rowToChunkText).map((t) => t || "(empty row)");
  const t0 = Date.now();
  const vectors = await embedBatch(texts);
  console.log(`[embed] ${vectors.length} chunks in ${Date.now() - t0}ms for "${doc.name}"`);

  const records = vectors.map((embedding, i) => ({
    datasetId: doc._id,
    ownerId:   doc.ownerId,
    rowIndex:  i,
    text:      texts[i],
    embedding,
  }));

  // Insert in batches of 200 so a single bulk write doesn't exceed Mongo limits.
  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    await DocumentChunk.insertMany(records.slice(i, i + BATCH), { ordered: false });
  }
  return records.length;
}

/** List datasets visible to the user: all built-ins plus their own uploads. */
async function listFor(user) {
  const docs = await Dataset.find({
    $or: [{ source: "company" }, { source: "user", ownerId: user._id }],
  }).sort({ source: 1, createdAt: -1 });
  return docs.map((d) => d.toListJSON());
}

/** Get one dataset (with rows). Built-ins are public; user datasets are owner-only. */
async function getFor(user, id) {
  const doc = await Dataset.findById(id);
  if (!doc) throw ApiError.notFound("Dataset not found");
  if (doc.source === "user" && doc.ownerId?.toString() !== user._id.toString()) {
    throw ApiError.forbidden("Not your dataset");
  }
  return doc;
}

/** Same as getFor but returns the full client JSON (rows included). */
async function getFullFor(user, id) {
  const doc = await getFor(user, id);
  return doc.toFullJSON();
}

/** Delete a user-owned dataset (and any RAG chunks). Built-ins cannot be deleted. */
async function removeFor(user, id) {
  const doc = await getFor(user, id);
  if (doc.source === "company") throw ApiError.forbidden("Built-in datasets cannot be removed");
  await DocumentChunk.deleteMany({ datasetId: doc._id });
  await doc.deleteOne();
}

/**
 * Parse a Multer-uploaded CSV/TSV buffer, profile columns, persist to Mongo.
 * Returns the saved dataset's list-shape JSON.
 */
async function uploadFor(user, file, { type } = {}) {
  if (!file?.buffer) throw ApiError.badRequest("No file uploaded");

  const text = file.buffer.toString("utf8");
  const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });

  if (!result.data || result.data.length === 0) {
    throw ApiError.badRequest("CSV is empty or unparseable");
  }
  if (result.data.length > MAX_UPLOAD_ROWS) {
    throw ApiError.badRequest(`Too many rows (max ${MAX_UPLOAD_ROWS.toLocaleString()})`);
  }

  const safeType = type === "unstructured" ? "unstructured" : "structured";
  const baseName = (file.originalname ?? "upload").replace(/\.[^.]+$/, "");

  const doc = await Dataset.create({
    name:        baseName,
    description: `Uploaded by ${user.name}`,
    source:      "user",
    type:        safeType,
    ownerId:     user._id,
    rowCount:    result.data.length,
    columns:     profileRows(result.data),
    rows:        result.data,
    fileName:    file.originalname ?? null,
  });

  // Unstructured datasets get embedded into the RAG index. Structured
  // datasets are queried via aggregation in queryService and don't need it.
  if (safeType === "unstructured") {
    try {
      await ingestChunksForDataset(doc);
    } catch (err) {
      // Don't fail the upload if embedding hits a transient error — chunks
      // can be (re)built later. Mark as best-effort and log loudly.
      console.error("[embed] ingest failed for", doc._id.toString(), err);
    }
  }

  return doc.toFullJSON();
}

export const datasetService = { listFor, getFor, getFullFor, removeFor, uploadFor, profileRows };
