import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDB() {
  mongoose.set("strictQuery", true);

  // Atlas M0 free tier occasionally drops the first TLS handshake on cold
  // connections. Retry a few times before giving up.
  const MAX_TRIES = 3;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      await mongoose.connect(env.MONGO_URI, {
        autoIndex: env.NODE_ENV !== "production",
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        heartbeatFrequencyMS: 10_000,
        retryWrites: true,
        retryReads:  true,
      });
      console.log(`[db] connected to ${mongoose.connection.name}`);
      return;
    } catch (err) {
      if (attempt === MAX_TRIES) throw err;
      const delay = 1500 * attempt;
      console.warn(`[db] connect attempt ${attempt} failed (${err.code ?? err.message}); retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
