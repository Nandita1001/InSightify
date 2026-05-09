import mongoose from "mongoose";
import { EMBEDDING_DIM } from "../services/embeddingService.js";

/**
 * DocumentChunk — one embedded chunk of an unstructured dataset (typically
 * one row of a CSV/feedback file). Stored in its own collection so that
 * deleting/uploading a dataset doesn't rewrite a giant Dataset document
 * and so retrieval can scope by datasetId without loading the parent.
 *
 * `embedding` is a Float64-castable array of EMBEDDING_DIM (384) numbers.
 * For our demo scale we run cosine similarity in Node (in-memory). At
 * larger scale you'd index this field as an Atlas Vector Search index and
 * use the $vectorSearch aggregation stage instead.
 */
const documentChunkSchema = new mongoose.Schema(
  {
    datasetId: { type: mongoose.Schema.Types.ObjectId, ref: "Dataset", required: true, index: true },
    ownerId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    rowIndex:  { type: Number, required: true },
    text:      { type: String, required: true },
    embedding: { type: [Number], required: true, validate: (v) => Array.isArray(v) && v.length === EMBEDDING_DIM },
  },
  { timestamps: true, minimize: false }
);

documentChunkSchema.index({ datasetId: 1, rowIndex: 1 });

export const DocumentChunk = mongoose.model("DocumentChunk", documentChunkSchema);
