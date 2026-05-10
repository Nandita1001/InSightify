/**
 * retrievalService — top-K nearest chunks for a question.
 *
 * Two backends, identical interface:
 *
 *   "memory" — fetch all chunks for the filter, rank in Node with cosine
 *     similarity. ~30ms per query at 10k chunks. Zero setup.
 *
 *   "atlas"  — MongoDB Atlas Vector Search via the $vectorSearch aggregation.
 *     Approximate-nearest-neighbour (HNSW) index on the `embedding` field.
 *     Stays fast as the corpus grows. Requires a one-time index creation
 *     in the Atlas UI:
 *
 *       Atlas → Search → Create Search Index → JSON Editor
 *       Database: insightify   Collection: documentchunks
 *       Name:    vector_index  (or whatever ATLAS_VECTOR_INDEX is set to)
 *       JSON:
 *       {
 *         "fields": [
 *           { "type": "vector", "path": "embedding",
 *             "numDimensions": 384, "similarity": "cosine" },
 *           { "type": "filter", "path": "datasetId" },
 *           { "type": "filter", "path": "ownerId" }
 *         ]
 *       }
 *
 * Switch via RETRIEVAL_BACKEND env var. The Atlas backend gracefully falls
 * back to memory if the aggregation errors (e.g. index not yet built).
 */

import mongoose from "mongoose";
import { DocumentChunk } from "../models/DocumentChunk.js";
import { embed, cosineSimilarity } from "./embeddingService.js";
import { env } from "../config/env.js";

/**
 * Coerce string ObjectIds to real ObjectIds for use inside $vectorSearch.filter,
 * which (unlike Mongoose's find()) doesn't auto-convert. Handles plain string
 * values and `{ $in: [...] }` operator values.
 */
function coerceFilter(filter = {}) {
  const out = {};
  const toOid = (x) =>
    typeof x === "string" && mongoose.isValidObjectId(x)
      ? new mongoose.Types.ObjectId(x)
      : x;
  for (const [k, v] of Object.entries(filter)) {
    if (v && typeof v === "object" && Array.isArray(v.$in)) {
      out[k] = { $in: v.$in.map(toOid) };
    } else {
      out[k] = toOid(v);
    }
  }
  return out;
}

/* ─── Memory backend ─────────────────────────────────────────────────── */

async function retrieveInMemory(filter, qVec, topK) {
  const chunks = await DocumentChunk
    .find(filter)
    .select({ text: 1, embedding: 1, rowIndex: 1, datasetId: 1 })
    .lean();

  if (chunks.length === 0) return { chunks: [], totalScanned: 0, backend: "memory" };

  const scored = chunks.map((c) => ({
    rowIndex:  c.rowIndex,
    text:      c.text,
    datasetId: c.datasetId,
    score:     cosineSimilarity(qVec, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);

  return { chunks: scored.slice(0, topK), totalScanned: chunks.length, backend: "memory" };
}

/* ─── Atlas Vector Search backend ────────────────────────────────────── */

async function retrieveViaAtlas(filter, qVec, topK) {
  // Atlas's filter operators only accept fields declared as "filter" type
  // in the search index config. We forward them straight through.
  const stage = {
    index:        env.ATLAS_VECTOR_INDEX,
    path:         "embedding",
    queryVector:  qVec,
    numCandidates: Math.max(topK * 10, 100),
    limit:         topK,
  };
  const coerced = coerceFilter(filter);
  if (coerced && Object.keys(coerced).length > 0) stage.filter = coerced;

  const docs = await DocumentChunk.aggregate([
    { $vectorSearch: stage },
    {
      $project: {
        _id:       0,
        rowIndex:  1,
        text:      1,
        datasetId: 1,
        score:     { $meta: "vectorSearchScore" },
      },
    },
  ]);

  // We can't cheaply know totalScanned with $vectorSearch; fall back to a
  // scoped count for the trust panel.
  const totalScanned = await DocumentChunk.countDocuments(filter);
  return { chunks: docs, totalScanned, backend: "atlas" };
}

/* ─── Public API ─────────────────────────────────────────────────────── */

/**
 * Retrieve the top-K most relevant chunks for `question`, scoped by filter.
 *
 * @param {object} filter   — Mongo query, e.g. { datasetId, ownerId }
 * @param {string} question — natural-language query
 * @param {number} topK     — number of chunks to return
 * @returns {Promise<{chunks, totalScanned, queryEmbedMs, backend}>}
 */
export async function retrieve(filter, question, topK = 10) {
  const t0 = Date.now();
  const qVec = await embed(question);
  const queryEmbedMs = Date.now() - t0;

  if (env.RETRIEVAL_BACKEND === "atlas") {
    try {
      const result = await retrieveViaAtlas(filter, qVec, topK);
      return { ...result, queryEmbedMs };
    } catch (err) {
      console.warn(
        `[retrieval] Atlas $vectorSearch failed (${err.message}); falling back to in-memory. ` +
        "If you haven't created the vector index yet, see retrievalService.js for the JSON config."
      );
      const result = await retrieveInMemory(filter, qVec, topK);
      return { ...result, queryEmbedMs, backend: "memory (fallback)" };
    }
  }

  const result = await retrieveInMemory(filter, qVec, topK);
  return { ...result, queryEmbedMs };
}
