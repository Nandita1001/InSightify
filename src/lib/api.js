/**
 * Thin fetch wrapper around the Insightify backend API.
 *
 * - Reads VITE_API_URL (defaults to http://localhost:4000).
 * - Stores the JWT access token in localStorage under "insightify:token".
 * - Attaches `Authorization: Bearer <token>` automatically.
 * - Normalizes error responses into Error objects with .status + .details.
 */

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "insightify:token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const finalHeaders = { "Content-Type": "application/json", ...headers };
  if (auth) {
    const token = getToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const message = data?.error?.message ?? `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}

export const authApi = {
  signup: (payload) => apiFetch("/api/auth/signup", { method: "POST", body: payload, auth: false }),
  login:  (payload) => apiFetch("/api/auth/login",  { method: "POST", body: payload, auth: false }),
  me:     () => apiFetch("/api/auth/me"),
  logout: () => apiFetch("/api/auth/logout", { method: "POST" }),
};

export const llmApi = {
  status:    () => apiFetch("/api/llm/status"),
  parse:     (payload) => apiFetch("/api/llm/parse",     { method: "POST", body: payload }),
  narrative: (payload) => apiFetch("/api/llm/narrative", { method: "POST", body: payload }),
};

export const accessApi = {
  roles:           () => apiFetch("/api/access/roles"),
  myRestrictions:  () => apiFetch("/api/access/me/restrictions"),
  listRequests:    () => apiFetch("/api/access/requests"),
  createRequest:   (payload) => apiFetch("/api/access/requests", { method: "POST", body: payload }),
  resolveRequest:  (id, status) => apiFetch(`/api/access/requests/${id}`, { method: "PATCH", body: { status } }),
};

/* ─── Multipart upload (FormData, no JSON Content-Type) ──────────────── */
async function postForm(path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: formData });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}

export const datasetApi = {
  list:   () => apiFetch("/api/datasets"),
  get:    (id) => apiFetch(`/api/datasets/${id}`),
  remove: (id) => apiFetch(`/api/datasets/${id}`, { method: "DELETE" }),
  upload: (file, type = "structured") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", type);
    return postForm("/api/datasets", fd);
  },
};

export const queryApi = {
  run:         (payload) => apiFetch("/api/query", { method: "POST", body: payload }),
  registry:    () => apiFetch("/api/query/registry"),
  dictionary:  ({ activeTab = "company", datasetId } = {}) => {
    const qs = new URLSearchParams({ activeTab });
    if (datasetId) qs.set("datasetId", datasetId);
    return apiFetch(`/api/query/dictionary?${qs}`);
  },
  suggestions: ({ activeTab = "company", datasetId } = {}) => {
    const qs = new URLSearchParams({ activeTab });
    if (datasetId) qs.set("datasetId", datasetId);
    return apiFetch(`/api/query/suggestions?${qs}`);
  },
};

