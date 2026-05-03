import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDB() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI, { autoIndex: env.NODE_ENV !== "production" });
  console.log(`[db] connected to ${mongoose.connection.name}`);
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
