# InSightify

A full-stack analytics platform for natural-language data queries with column-level role-based access control, real-time access-request workflows, and a Retrieval-Augmented Generation pipeline for unstructured datasets.

Originally built as a hackathon prototype on Supabase + a client-side analytics engine, then re-architected end-to-end into a self-hosted MERN application.

---

## Overview

InSightify solves two problems:

1. **Natural-language data analysis.** Non-technical users ask questions like *"revenue by region over time"* or *"which month had the worst customer feedback?"* instead of writing SQL or building dashboards. An LLM parses intent into a structured analysis plan; a deterministic analytics engine executes it (so the actual numbers are never hallucinated).

2. **Controlled access to sensitive data.** Organizations are split into roles (Owner, Finance, Marketing, HR). Each role has a column-level restriction matrix (e.g. HR cannot see `revenue` or `cost`). When a user queries a restricted column, the server blocks it and surfaces a request-access workflow that the Owner approves or denies — with the answer propagated to the requester in real time.

For unstructured datasets (free-text feedback, support tickets, logs), the platform uses an in-process RAG pipeline so the LLM only sees the rows that are semantically relevant to the user's question.

---

## Architecture

```
┌──────────────────────┐    HTTPS (REST) + WebSocket    ┌──────────────────────┐
│  React 19 + Vite     │ ◄─────────────────────────────► │  Node + Express      │
│  (frontend)          │   /api/auth   /api/llm          │  (backend, this repo)│
│  • react-router-dom  │   /api/access /api/datasets     │                      │
│  • socket.io-client  │   /api/query  socket.io         │                      │
└──────────────────────┘                                 └──────────┬───────────┘
                                                                    │
                                          ┌─────────────────────────┼─────────────────────────┐
                                          │                         │                         │
                                  ┌───────▼────────┐       ┌────────▼─────────┐      ┌────────▼─────────┐
                                  │  MongoDB Atlas │       │  Groq LLM        │      │  Socket.IO       │
                                  │  (or local)    │       │  llama-3.1-8b    │      │  (realtime)      │
                                  │                │       │                  │      │                  │
                                  │  + Vector      │       │  Backend owns    │      │  JWT handshake   │
                                  │    Search      │       │  the API key +   │      │  auth            │
                                  │    (HNSW)      │       │  prompt          │      │                  │
                                  └────────────────┘       │  templates       │      └──────────────────┘
                                                           └──────────────────┘
```

Three external dependencies — Mongo, Groq, the user's browser. **Everything else runs inside the Node process,** including the embedding model for RAG.

---

## Tech Stack

**Frontend** — React 19, Vite, TailwindCSS, Recharts, Lucide React, react-router-dom, socket.io-client. Custom fetch wrapper with bearer-token storage. React Context for global state (no Redux).

**Backend** — Node.js, Express 4, ES modules. MongoDB + Mongoose. Helmet, CORS, Morgan, `express-rate-limit`. `bcryptjs` (cost factor 12) for passwords, `jsonwebtoken` for stateless auth. `zod` for env + request body validation. `multer` (memory storage) for CSV/Excel uploads. `papaparse` for CSV parsing. `socket.io` with JWT-handshake auth for realtime.

**RAG layer** — `@huggingface/transformers` (Transformers.js, ONNX runtime) running in-process with `Xenova/all-MiniLM-L6-v2` (384-dim). No third-party embedding API; question text never leaves the Node process. Two retrieval backends behind one interface:
- **In-process cosine similarity** for demo/dev (zero setup)
- **MongoDB Atlas Vector Search** via `$vectorSearch` aggregation for scale (HNSW ANN index)

**LLM** — Groq (`llama-3.1-8b-instant`) for query parsing and narrative generation. The backend owns the API key and prompt templates; the client only sends structured inputs (`{question, registry, context}`), preventing both API-key leakage and arbitrary prompt injection on our infrastructure.

**Tests** — Vitest + Supertest + `mongodb-memory-server` (fully self-contained, no Atlas required). 22 tests covering auth, access workflow, RBAC, and dataset CRUD.

**Containerization** — Dockerfile (multi-stage, non-root user) and `docker-compose.yml` (server + Mongo) for one-command local stack.

---

## Features

### Access Control & Security
- Role-based access system (Owner, Finance, Marketing, HR)
- Column-level data restrictions for sensitive fields, defined in a single permission matrix on the server (`config/permissions.js`)
- Server-enforced RBAC at the query API boundary — even if the client cache is tampered with, the server blocks restricted columns before any data processing
- Access request system when restricted data is queried
- Owner approve/deny workflow with state-machine guards (409 on already-resolved)
- Real-time updates via Socket.IO (replaces Supabase Realtime); JWT handshake auth on the socket layer

### Data Analysis
- Hand-written deterministic analytics engine: aggregations (sum/avg/min/max/count), trend detection, comparisons, breakdowns, anomaly detection, correlation, sentiment scan
- Natural-language query parsing via Groq with deterministic fallback templates if the LLM is unavailable
- Multi-step plans with intent detection and dataset selection
- Per-request dataset registry — each query loads only the datasets the user can see (no cross-user leakage)

### RAG for Unstructured Data
- On upload, every row is embedded with all-MiniLM-L6-v2 (in-process) and stored as a `DocumentChunk`
- At query time, the question is embedded, top-K chunks are retrieved (cosine similarity in Node, or `$vectorSearch` against Atlas), and an augmented prompt with `[Row N]` citations is sent to the LLM
- Trust panel surfaces the retrieved rows + similarity scores so users see exactly which data answered their question
- Pluggable retrieval backend via env var (`RETRIEVAL_BACKEND=memory|atlas`) with graceful fallback when the Atlas index is unavailable

### Data Handling
- Multer-backed CSV/TSV/Excel upload via `POST /api/datasets`
- Automatic column profiling: type inference (numeric / categorical / date / text), per-type stats (min/max/mean/median/stdDev for numeric, frequency tables for categorical, sample text for text)
- Built-in datasets seeded once on first boot via idempotent `seedBuiltIns()`
- Cascade-delete of embedded chunks when a dataset is removed

### User Interface
- Chat-based interface for interacting with data
- Browser-routed pages: `/login`, `/signup`, `/` (with `ProtectedRoute` and `GuestRoute` guards)
- Optimistic UI updates on access approve/deny — buttons flip instantly, server confirms in background
- Switch between "Company Data" and "My Data" modes
- Dynamic charts (bar, line, pie, table) auto-selected by analysis intent
- Dropdown panels for registry, data dictionary, restricted columns

---

## Screenshots

### 1. Main Interface – Chat-Based Data Interaction
<img width="1365" height="678" alt="Main interface" src="https://github.com/user-attachments/assets/e3e2019c-4297-49ba-b53c-544e8028f5b8" />

### 2. AI-Powered Insights & Answers
<img width="1365" height="685" alt="AI insights" src="https://github.com/user-attachments/assets/507409d3-f553-4f2e-b093-35c5297dd682" />

### 3. Data Visualization & Charts
<img width="1364" height="681" alt="Charts" src="https://github.com/user-attachments/assets/8680e5ac-2626-48b3-9735-ecc8a35c463c" />

### 4. Explainability & Trust Panel
<img width="1365" height="684" alt="Trust panel" src="https://github.com/user-attachments/assets/d2e7670e-ea5c-4390-ab4d-dcc524f9e44e" />

### 5. Access Control & Permission Request
<img width="1365" height="680" alt="Access control" src="https://github.com/user-attachments/assets/cd0739b0-193a-4b85-bcd4-8a6f5248215b" />

### 6. Owner Approval Workflow
<img width="1365" height="682" alt="Owner approval" src="https://github.com/user-attachments/assets/b8946534-ec97-4791-bcc9-9eeb8f1a43fb" />

### 7. Access Granted & Query Execution
<img width="1365" height="685" alt="Access granted" src="https://github.com/user-attachments/assets/9c0264c5-bbc7-4683-8b06-ed3478aefdae" />

### 8. Upload & Analyze Your Own Data
<img width="1363" height="684" alt="Upload data" src="https://github.com/user-attachments/assets/3f3fdfe0-5007-4ed5-8a7f-641e14fea461" />

### 9. Unstructured Data Querying
<img width="1363" height="681" alt="Unstructured queries" src="https://github.com/user-attachments/assets/df58d7e7-34d9-45fe-8f39-ffcbc29e2aa2" />

---

## Local Development

You can run the whole stack one of two ways.

### Option A — Docker Compose (one command)

Best when you want to clone-and-go without installing Node or Mongo locally.

```bash
git clone https://github.com/TanishAhuja/talk-to-data.git
cd talk-to-data

# Set the required secrets in your shell or in a project-root .env file:
export JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
export GROQ_API_KEY=<your-groq-api-key>      # optional; falls back to deterministic templates

docker compose up --build
```

Backend will be at `http://localhost:4000`. Mongo is reachable at `localhost:27017` and persisted in a Docker volume. Run the frontend separately:

```bash
echo "VITE_API_URL=http://localhost:4000" > .env
npm install
npm run dev                                  # http://localhost:5173
```

### Option B — Manual setup (Node + MongoDB Atlas)

Best when you want to develop both sides with hot reload.

```bash
git clone https://github.com/TanishAhuja/talk-to-data.git
cd talk-to-data

# 1. Backend
cd server
cp .env.example .env
# Fill MONGO_URI (Atlas connection string), JWT_ACCESS_SECRET (random 48 bytes),
# and GROQ_API_KEY (optional). See the Environment Variables section below.
npm install
npm run dev                                  # http://localhost:4000

# 2. Frontend (separate terminal)
cd ..
echo "VITE_API_URL=http://localhost:4000" > .env
npm install
npm run dev                                  # http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) — you'll be redirected to `/login`.

---

## Environment Variables

### Backend (`server/.env`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGO_URI` | yes | — | MongoDB Atlas connection string, or `mongodb://localhost:27017/insightify` for local |
| `JWT_ACCESS_SECRET` | yes | — | 48+ random bytes. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_ACCESS_TTL` | no | `7d` | JWT expiry |
| `PORT` | no | `4000` | Backend port |
| `NODE_ENV` | no | `development` | `production` enables sanitized 5xx error messages |
| `CORS_ORIGIN` | no | `http://localhost:5173` | Frontend origin for CORS |
| `GROQ_API_KEY` | no | — | Without it, `/api/llm/*` returns 503 and the query pipeline falls back to deterministic templates |
| `GROQ_MODEL` | no | `llama-3.1-8b-instant` | |
| `GROQ_TEMPERATURE` | no | `0.1` | |
| `RETRIEVAL_BACKEND` | no | `memory` | `memory` (in-process cosine) or `atlas` (Atlas Vector Search) |
| `ATLAS_VECTOR_INDEX` | no | `vector_index` | Name of the Atlas vector search index when `RETRIEVAL_BACKEND=atlas` |

### Frontend (`.env` at project root)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | no | `http://localhost:4000` | Backend base URL — set this to your deployed backend in production builds |

---

## API Surface

All routes under `/api`, all bodies/responses JSON.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/signup` | public | Create user + return JWT (rate-limited 20/15min) |
| POST | `/auth/login` | public | bcrypt compare + return JWT |
| GET | `/auth/me` | bearer | Restore session — verify JWT, return user |
| POST | `/auth/logout` | bearer | Stateless no-op (client discards token) |
| GET | `/llm/status` | bearer | `{available: bool}` based on whether `GROQ_API_KEY` is set |
| POST | `/llm/parse` | bearer | Body: `{question, registry, context}` → raw LLM analysis plan |
| POST | `/llm/narrative` | bearer | Body: `{question, result, metadata}` → explanatory narrative |
| GET | `/access/roles` | bearer | List role names |
| GET | `/access/me/restrictions` | bearer | Current user's effective restricted columns |
| GET | `/access/requests` | bearer | Owner sees all; non-owner sees own |
| POST | `/access/requests` | bearer | Body: `{columns, reason}` — auto-dedupes pending |
| PATCH | `/access/requests/:id` | bearer + Owner | Body: `{status: "approved"\|"denied"}` |
| GET | `/datasets` | bearer | Visible datasets (built-ins + own uploads) |
| GET | `/datasets/:id` | bearer | Full dataset incl. rows |
| POST | `/datasets` | bearer | Multer multipart — parse, profile, persist |
| DELETE | `/datasets/:id` | bearer | Own datasets only |
| POST | `/query` | bearer | Full NL → analysis → narrative pipeline (rate-limited 20/min) |
| GET | `/query/registry` | bearer | Summary of user's visible datasets |
| GET | `/query/dictionary` | bearer | Data dictionary entries |
| GET | `/query/suggestions` | bearer | Auto-generated query suggestions |

**WebSocket events** (Socket.IO with JWT handshake):
- `access_requests:changed` — broadcast on every create/resolve

---

## Tests

```bash
cd server
npm test
```

Runs 22 tests across auth, access workflow, RBAC, and dataset CRUD using `mongodb-memory-server` for isolation. First run downloads ~120MB Mongo binary (one-time, cached).

---

## Backend Folder Layout

```
server/src/
├── app.js                         # Express composition (middleware → routes → error handler)
├── server.js                      # Boot: connect DB → seed built-ins → attach socket.io → listen
├── config/
│   ├── db.js                      # Mongoose connect with cold-start retry
│   ├── env.js                     # Zod-validated process.env (refuses to boot on bad config)
│   ├── permissions.js             # Role permission matrix (single source of truth for RBAC)
│   └── dataDictionary.js          # Column definitions + derived metric formulas
├── models/
│   ├── User.js                    # bcrypt password hashing
│   ├── AccessRequest.js           # state machine (pending → approved/denied)
│   ├── Dataset.js                 # rows + profiled columns embedded
│   └── DocumentChunk.js           # per-row embeddings for RAG
├── middleware/
│   ├── auth.js                    # JWT verification → req.user
│   ├── rbac.js                    # requireOwner
│   ├── validate.js                # Zod schema factory
│   └── errorHandler.js            # 404 + central handler with sanitized 500s
├── validators/                    # Zod schemas per resource
├── controllers/                   # Thin: parse req → call service → send res
├── services/
│   ├── authService.js
│   ├── accessService.js           # CRUD + dedupe + state-machine guard + emits realtime events
│   ├── llmService.js              # Owns prompt templates + summary builders
│   ├── groqService.js             # Low-level Groq HTTP wrapper
│   ├── datasetService.js          # CSV parse + column profiling + idempotent seeding
│   ├── queryService.js            # Full query orchestrator with per-request registry shim
│   ├── queryFallbacks.js          # Deterministic regex parser + narrative templates
│   ├── analysisOps.js             # Pure analytics functions
│   ├── embeddingService.js        # In-process Transformers.js singleton
│   ├── retrievalService.js        # Two backends behind one interface (memory + atlas)
│   └── realtime.js                # Socket.IO singleton wrapper for cross-service emits
├── routes/                        # Express Router per resource, applies rate limits
└── utils/
    ├── ApiError.js
    ├── asyncHandler.js
    └── jwt.js
```

---

## Deployment

The frontend is a static Vite build and deploys cleanly to Vercel/Netlify/Cloudflare Pages. The backend is a long-running Node process and needs a host that supports it (Render, Railway, Fly.io, Heroku-style).

### Backend on Render (free tier)

1. Push this repo to GitHub.
2. Render dashboard → New → Web Service → connect the GitHub repo.
3. Settings:
   - Root directory: `server`
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
4. Environment variables — paste in everything from the [Environment Variables](#environment-variables) table. At minimum: `MONGO_URI`, `JWT_ACCESS_SECRET`, `GROQ_API_KEY`, `CORS_ORIGIN` (set to your deployed frontend URL).
5. Deploy. Render will give you a `*.onrender.com` URL.

### Frontend on Vercel

1. Vercel dashboard → Add New → Project → connect the GitHub repo.
2. Framework: Vite (auto-detected). Root directory: `./` (project root).
3. Environment variables → `VITE_API_URL` set to your Render URL from above.
4. Deploy.

### Atlas Vector Search index (only if `RETRIEVAL_BACKEND=atlas`)

One-time setup in the Atlas UI:

1. Cluster → **Atlas Search** → Create Search Index → **Atlas Vector Search**
2. Database: `insightify`, Collection: `documentchunks`
3. Index name: `vector_index` (matches `ATLAS_VECTOR_INDEX` default)
4. JSON config:
   ```json
   {
     "fields": [
       { "type": "vector", "path": "embedding", "numDimensions": 384, "similarity": "cosine" },
       { "type": "filter", "path": "datasetId" },
       { "type": "filter", "path": "ownerId" }
     ]
   }
   ```
5. Wait ~30-60 seconds for the index to build.

If `RETRIEVAL_BACKEND=memory`, skip this entirely — the in-process cosine similarity path requires no Atlas configuration.

---

## Security Highlights

- **Passwords** never stored in plaintext — `bcrypt.hash(password, 12)` with per-user salt
- **JWT** signed with HS256, 7-day expiry, payload contains `sub` (user id) + `role`
- **Generic auth errors** — same message for "unknown email" vs "wrong password" (prevents user enumeration)
- **Rate limiting** — auth endpoints capped per IP, LLM and query endpoints capped per user-id
- **Helmet** sets CSP, X-Frame-Options, HSTS, X-Content-Type-Options
- **CORS** scoped to a single origin, not `*`
- **Zod validation** at every API entry point with per-field error details
- **RBAC enforced server-side**:
  - `requireOwner` middleware blocks non-owner approve/deny
  - `accessService.listRequests` filters by `userId` for non-owners — a non-owner cannot even *see* others' requests
  - `queryService.checkAccessForUser` blocks queries that touch restricted columns *before* any data processing runs
- **State-machine guard** on resolve — once approved/denied, can't be re-resolved (returns 409)
- **Socket.IO JWT handshake** — `io.use(...)` middleware verifies token at connection; unauthenticated sockets never reach the connection event
- **LLM proxy** — backend owns the Groq API key + prompt templates. Client only sends structured inputs (`{question, registry, context}`) and cannot craft arbitrary prompts to abuse the budget

---

## Scaling Considerations

This project demonstrates the architectural patterns at small scale (≤100k rows per dataset, ≤10 datasets, ≤1M chunks total). At each tier above, parts of the stack change:

| Tier | Data size | Stack changes |
|---|---|---|
| Demo (this repo) | <100k rows, <10 datasets | Mongo embedded rows, in-process JS analytics, in-process embeddings, dual retrieval backend |
| Mid-market | 1-100M rows, <100 datasets | Postgres/Snowflake warehouse with LLM-generated SQL, Atlas Vector Search (or Qdrant), dedicated embedding service (TEI / vLLM) |
| Enterprise | Billions of rows, 1000s of datasets | Snowflake/BigQuery, hybrid search (BM25 + dense vectors with reciprocal rank fusion), cross-encoder reranker, RAG over schema, document-level RBAC via metadata filters, fine-tuned SQL model |

Specific upgrade paths documented in code comments:
- `retrievalService.js` — switching from `memory` to `atlas` backend at >50k chunks per dataset
- `Dataset.js` — replacing embedded rows with a separate `rows` collection (or GridFS) past the 16MB doc limit
- `queryService.js` — replacing the in-process registry shim with a SQL generator + warehouse executor at hundreds of tables
- `groqService.js` — swapping to a self-hosted LLM (Ollama, vLLM, TGI) for data-residency-sensitive deployments

---

## License

MIT — see [LICENSE](./LICENSE).
