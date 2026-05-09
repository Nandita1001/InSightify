/**
 * embeddingService — text → 384-dim float vectors, fully in-process.
 *
 * Uses Hugging Face Transformers.js (ONNX runtime) with `Xenova/all-MiniLM-L6-v2`.
 * The model is ~25MB, downloaded once on first call and cached on disk by
 * the runtime. Embedding cost on CPU is roughly 30-80ms per short text.
 *
 * Why local instead of OpenAI's embedding API:
 *   - data residency: question text never leaves the Node process
 *   - no per-call cost
 *   - no rate limit
 *   - works offline once the model is cached
 *
 * The model is loaded lazily (on first embed call) via a singleton so cold
 * boot stays fast. Subsequent calls reuse the loaded pipeline.
 */

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

let _pipelinePromise = null;

async function getPipeline() {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      console.log(`[embed] loading model ${MODEL_ID} (first call only)…`);
      const t0 = Date.now();
      const ext = await pipeline("feature-extraction", MODEL_ID);
      console.log(`[embed] model ready in ${Date.now() - t0}ms`);
      return ext;
    })();
  }
  return _pipelinePromise;
}

/** Embed a single string into a Float32Array of length EMBEDDING_DIM. */
export async function embed(text) {
  const ext = await getPipeline();
  const out = await ext(text, { pooling: "mean", normalize: true });
  // out.data is a Float32Array view; copy to a regular array for Mongo
  return Array.from(out.data);
}

/**
 * Embed many strings. Sequential is fine for our scale; the model is
 * single-threaded and parallel calls would just queue inside ONNX anyway.
 */
export async function embedBatch(texts) {
  const out = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}

/** Cosine similarity of two normalised vectors == dot product. */
export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Pre-warm the model in the background (optional; called from server.js). */
export function warmUp() {
  getPipeline().catch((err) => console.warn("[embed] warm-up failed:", err.message));
}
