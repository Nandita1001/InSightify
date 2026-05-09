import http from "node:http";
import { Server as SocketServer } from "socket.io";

import { env } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { createApp } from "./app.js";
import { setIO } from "./services/realtime.js";
import { seedBuiltIns } from "./services/datasetService.js";
import { warmUp as warmUpEmbeddings } from "./services/embeddingService.js";
import { verifyAccessToken } from "./utils/jwt.js";

function attachSocketIO(httpServer) {
  const io = new SocketServer(httpServer, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
  });

  // JWT handshake: socket.handshake.auth.token is sent by the client.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("missing token"));
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.role   = payload.role;
      next();
    } catch {
      next(new Error("invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected user=${socket.data.userId} role=${socket.data.role}`);
    socket.on("disconnect", () => {
      console.log(`[socket] disconnected user=${socket.data.userId}`);
    });
  });

  setIO(io);
  return io;
}

async function bootstrap() {
  await connectDB();
  // Seeding is best-effort — built-ins persist across boots, so a transient
  // Atlas TLS drop here shouldn't crash the server. Log and continue.
  try {
    await seedBuiltIns();
  } catch (err) {
    console.warn("[server] seedBuiltIns failed (continuing):", err.message);
  }
  // Pre-load the embedding model in the background so the first user upload
  // doesn't pay a 5–10s cold-start penalty.
  warmUpEmbeddings();
  const app = createApp();
  const httpServer = http.createServer(app);
  attachSocketIO(httpServer);

  httpServer.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received — shutting down`);
    httpServer.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
