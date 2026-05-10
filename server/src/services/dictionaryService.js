/**
 * dictionaryService — runtime-editable business glossary backed by Mongo.
 *
 * Replaces the old hardcoded DATA_DICTIONARY constant. Same lazy-seed +
 * cache-and-invalidate pattern as permissionsService.
 *
 * Reads return ALL global entries plus any entries scoped to a specific
 * datasetId (when provided). Writes are admin-only.
 */

import { DictionaryEntry } from "../models/DictionaryEntry.js";
import { DEFAULT_DICTIONARY } from "../config/dataDictionary.js";
import { ApiError } from "../utils/ApiError.js";

let _cache = null;

async function ensureCache() {
  if (_cache) return _cache;
  await seedIfEmpty();
  await refresh();
  return _cache;
}

async function refresh() {
  const docs = await DictionaryEntry.find();
  _cache = docs.map((d) => d.toJSON());
}

async function seedIfEmpty() {
  const count = await DictionaryEntry.estimatedDocumentCount();
  if (count > 0) return;

  const docs = DEFAULT_DICTIONARY.map((d) => ({
    name:  d.name,
    def:   d.def,
    scope: "global",
  }));
  try {
    await DictionaryEntry.insertMany(docs, { ordered: false });
    console.log(`[dictionary] seeded ${docs.length} default entries`);
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

/* ─── Reads ───────────────────────────────────────────────────────────── */

/** All global entries plus dataset-scoped if a datasetId is provided. */
export async function getDictionary(datasetId = null) {
  const cache = await ensureCache();
  if (!datasetId) return cache.filter((e) => e.scope === "global");
  return cache.filter((e) => e.scope === "global" || e.scope === datasetId);
}

export async function listAll() {
  return ensureCache();
}

/* ─── Admin write API ─────────────────────────────────────────────────── */

export async function createEntry({ name, def, scope = "global" }) {
  const doc = await DictionaryEntry.create({
    name:  String(name).trim(),
    def:   String(def).trim(),
    scope: String(scope).trim() || "global",
  });
  await refresh();
  return doc.toJSON();
}

export async function updateEntry(id, { name, def, scope }) {
  const update = {};
  if (name  !== undefined) update.name  = String(name).trim();
  if (def   !== undefined) update.def   = String(def).trim();
  if (scope !== undefined) update.scope = String(scope).trim() || "global";

  const doc = await DictionaryEntry.findByIdAndUpdate(id, update, { new: true });
  if (!doc) throw ApiError.notFound("Dictionary entry not found");
  await refresh();
  return doc.toJSON();
}

export async function deleteEntry(id) {
  const doc = await DictionaryEntry.findByIdAndDelete(id);
  if (!doc) throw ApiError.notFound("Dictionary entry not found");
  await refresh();
}

export function _clearCache() {
  _cache = null;
}
