# ─── 1. Build / install layer ─────────────────────────────────────────────
# Multi-stage so the final image doesn't carry the npm cache or dev deps.
FROM node:22-alpine AS deps

WORKDIR /app

# Copy only the lockfiles first so Docker can cache the install layer until
# they actually change. Slot in the rest of the source after.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ─── 2. Runtime image ─────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user. node:alpine ships a `node` user (uid 1000); use it
# instead of root so a compromised process can't trivially mutate the image.
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 4000

# `node --watch` is dev-only. Production uses plain node.
CMD ["node", "src/server.js"]
