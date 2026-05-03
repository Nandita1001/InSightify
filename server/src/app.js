import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import llmRoutes from "./routes/llmRoutes.js";
import accessRoutes from "./routes/accessRoutes.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  if (env.NODE_ENV !== "test") app.use(morgan("dev"));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/llm", llmRoutes);
  app.use("/api/access", accessRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
