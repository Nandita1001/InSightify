/**
 * retrievalService — top-K nearest chunks via cosine similarity.
 *
 * For our demo scale (low thousands of chunks per dataset) we fetch all
 * chunks for the filter and rank them in Node. Cosine of normalised vectors
 * is just a dot product; at 384-dim and 10k chunks that's ~30ms.
 *
 * Upgrade path at >50k chunks: switch to MongoDB Atlas Vector Search
 * with a vector index on `embedding` and use the $vectorSearch aggregation.
 * The retrieve() interface stays identical.
 */

import { DocumentChunk } from "../models/DocumentChunk.js";
import { embed, cosineSimilarity } from "./embeddingService.js";

/**
 * Retrieve the top-K most relevant chunks for `question`, scoped by filter.
 *
 * @param {object} filter   — Mongo query (e.g. { datasetId, ownerId })
 * @param {string} question — natural-language query
 * @param {number} topK     — number of chunks to return
 * @returns {Promise<{chunks: Array, totalScanned: number, queryEmbedMs: number}>}
 */
export async function retrieve(filter, question, topK = 10) {
  const t0 = Date.now();
  const qVec = await embed(question);
  const queryEmbedMs = Date.now() - t0;

  // Fetch only what we need. `text` and `embedding` are required for ranking;
  // rowIndex + datasetId let the caller cite source rows in the response.
  const chunks = await DocumentChunk
    .find(filter)
    .select({ text: 1, embedding: 1, rowIndex: 1, datasetId: 1 })
    .lean();

  if (chunks.length === 0) return { chunks: [], totalScanned: 0, queryEmbedMs };

  // Compute similarity, sort desc, slice top-K. Mutates a new score field.
  const scored = chunks.map((c) => ({
    rowIndex: c.rowIndex,
    text: c.text,
    datasetId: c.datasetId,
    score: cosineSimilarity(qVec, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);

  return {
    chunks: scored.slice(0, topK),
    totalScanned: chunks.length,
    queryEmbedMs,
  };
}
