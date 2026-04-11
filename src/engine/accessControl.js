/**
 * accessControl.js — Role-Based Column-Level Access Control
 *
 * Restrictions are based on the ACTUAL columns present in the 4 company datasets:
 *
 *  Sales Performance:   month, region, product, channel, revenue, units, cost, returns, ad_spend
 *  Customer Behavior:   week, signups, churn, active_users, avg_handle_time, nps, tickets, resolution_rate, channel
 *  Financial Reports:   department, category, Q1, Q2, Q3, Q4, headcount
 *  Customer Feedback:   date, region, text
 *
 * Role philosophy:
 *  - Owner       → sees everything (no restrictions)
 *  - Finance Team → owns financials; blocked from raw text/PII, customer-support ops metrics
 *  - Marketing   → owns campaigns/acquisition; blocked from cost/budget internals, ops metrics
 *  - HR Team     → owns people data; blocked from customer metrics and financial detail
 */

/* ═══════════════════════════════════════════════════════════
   §1  ROLE PERMISSION DEFINITIONS
   (based on actual dataset columns only)
═══════════════════════════════════════════════════════════ */

const ROLE_PERMISSIONS = {
  Owner: {
    restricted: [],
    canApprove: true,
  },

  /* Finance Team — can see revenue, cost, ad_spend, Q1-Q4, headcount.
     Blocked from: customer support ops (avg_handle_time, tickets, resolution_rate, nps)
                   and raw qualitative text (PII / GDPR risk). */
  "Finance Team": {
    restricted: [
      { col: "text",            reason: "Raw customer feedback — PII / GDPR restricted" },
      { col: "nps",             reason: "Customer experience metric — owned by Customer Success" },
      { col: "avg_handle_time", reason: "Support operations metric — not financial data" },
      { col: "tickets",         reason: "Support operations metric — not financial data" },
      { col: "resolution_rate", reason: "Support operations metric — not financial data" },
    ],
    canApprove: false,
  },

  /* Marketing Team — can see revenue, signups, churn, nps, channel, product, region.
     Blocked from: internal cost breakdown, quarterly budget detail, headcount (confidential),
                   support ops metrics (not marketing's purview). */
  "Marketing Team": {
    restricted: [
      { col: "cost",            reason: "Internal cost data — Finance confidential" },
      { col: "ad_spend",        reason: "Budget allocation — Finance confidential" },
      { col: "Q1",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "Q2",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "Q3",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "Q4",              reason: "Quarterly budget breakdown — Finance confidential" },
      { col: "headcount",       reason: "Headcount data — HR confidential" },
      { col: "avg_handle_time", reason: "Support operations metric — not marketing data" },
      { col: "resolution_rate", reason: "Support operations metric — not marketing data" },
    ],
    canApprove: false,
  },

  /* HR Team — can see headcount, department, signups, churn, active_users.
     Blocked from: all financial figures (revenue, cost, ad_spend, Q1-Q4),
                   customer experience scores, and raw feedback text (PII). */
  "HR Team": {
    restricted: [
      { col: "revenue",   reason: "Financial data — Finance Team only" },
      { col: "cost",      reason: "Financial data — Finance Team only" },
      { col: "ad_spend",  reason: "Marketing budget — Finance/Marketing only" },
      { col: "Q1",        reason: "Quarterly financials — Finance Team only" },
      { col: "Q2",        reason: "Quarterly financials — Finance Team only" },
      { col: "Q3",        reason: "Quarterly financials — Finance Team only" },
      { col: "Q4",        reason: "Quarterly financials — Finance Team only" },
      { col: "nps",       reason: "Customer experience KPI — Customer Success only" },
      { col: "text",      reason: "Raw customer feedback — PII / GDPR restricted" },
      { col: "returns",   reason: "Sales returns detail — Sales/Finance only" },
    ],
    canApprove: false,
  },
};

/* ─── Mutable restriction index per role: role → Map<lowercaseCol, reason> ─── */
const _restrictionIndex = {};
for (const [role, config] of Object.entries(ROLE_PERMISSIONS)) {
  _restrictionIndex[role] = new Map(
    config.restricted.map(({ col, reason }) => [col.toLowerCase(), reason])
  );
}

/* ═══════════════════════════════════════════════════════════
   §2  IN-MEMORY ACCESS REQUESTS STORE
═══════════════════════════════════════════════════════════ */

let _requests = [
  {
    id: 1001,
    from: "Marketing Team",
    columns: ["cost", "ad_spend"],
    reason: "Need cost data to calculate ROI for campaigns",
    status: "pending",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
  },
  {
    id: 1002,
    from: "HR Team",
    columns: ["revenue"],
    reason: "Needed for executive compensation benchmarking",
    status: "pending",
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000),
  },
  {
    id: 1003,
    from: "Finance Team",
    columns: ["nps"],
    reason: "Required for quarterly business review dashboard",
    status: "approved",
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
];

let _nextId = 2000;

/* ═══════════════════════════════════════════════════════════
   §3  EXPORTED ACCESS CONTROL FUNCTIONS
═══════════════════════════════════════════════════════════ */

/**
 * Check whether a role can access all of the required columns.
 * Respects dynamically granted access from approved requests.
 */
export function checkAccess(role, requiredColumns) {
  if (role === "Owner" || !ROLE_PERMISSIONS[role]) {
    return { allowed: true, blockedColumns: [] };
  }

  const index = _restrictionIndex[role];
  const blocked = [];

  for (const col of (requiredColumns ?? [])) {
    const reason = index.get(col.toLowerCase());
    if (reason !== undefined) {
      blocked.push({ col, reason });
    }
  }

  return {
    allowed: blocked.length === 0,
    blockedColumns: blocked,
  };
}

/**
 * Return the CURRENT restricted column list for a role.
 * Reads from the live _restrictionIndex so approved grants are reflected immediately.
 */
export function getRestrictions(role) {
  if (role === "Owner" || !_restrictionIndex[role]) return [];
  return Array.from(_restrictionIndex[role].entries()).map(([col, reason]) => ({
    col: ROLE_PERMISSIONS[role]?.restricted.find(
      (r) => r.col.toLowerCase() === col
    )?.col ?? col,
    reason,
  }));
}

/** Return all defined role names. */
export function getRoles() {
  return Object.keys(ROLE_PERMISSIONS);
}

/** Return whether a role can approve access requests. */
export function canApprove(role) {
  return ROLE_PERMISSIONS[role]?.canApprove ?? false;
}

/* ═══════════════════════════════════════════════════════════
   §4  ACCESS REQUEST WORKFLOW
═══════════════════════════════════════════════════════════ */

/**
 * Create a new access request.
 * Deduplicates: returns existing pending request if same role+columns already pending.
 */
export function createAccessRequest(fromRole, columns, reason = "") {
  const normalizedCols = [].concat(columns).map((c) => c.toLowerCase()).sort();

  const existing = _requests.find((r) => {
    if (r.from !== fromRole || r.status !== "pending") return false;
    const existing = r.columns.map((c) => c.toLowerCase()).sort();
    return (
      existing.length === normalizedCols.length &&
      existing.every((c, i) => c === normalizedCols[i])
    );
  });

  if (existing) return { ...existing };

  const request = {
    id: _nextId++,
    from: fromRole,
    columns: [].concat(columns),
    reason,
    status: "pending",
    timestamp: new Date(),
  };
  _requests.push(request);
  return { ...request };
}

/** Return all access requests (shallow copies), newest first. */
export function getAccessRequests() {
  return [..._requests]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((r) => ({ ...r }));
}

/** Return only pending access requests. */
export function getPendingRequests() {
  return _requests.filter((r) => r.status === "pending").map((r) => ({ ...r }));
}

/**
 * Approve an access request by id.
 * Dynamically removes approved columns from the role's restriction index
 * and from ROLE_PERMISSIONS.restricted — so checkAccess() and getRestrictions()
 * immediately reflect the grant on the next call.
 */
export function approveRequest(requestId) {
  const req = _requests.find((r) => r.id === requestId);
  if (!req) return null;

  req.status = "approved";
  req.resolvedAt = new Date();

  const roleIndex = _restrictionIndex[req.from];
  if (roleIndex) {
    for (const col of req.columns) {
      roleIndex.delete(col.toLowerCase());
    }
    const perms = ROLE_PERMISSIONS[req.from];
    if (perms) {
      const lowerApproved = req.columns.map((c) => c.toLowerCase());
      perms.restricted = perms.restricted.filter(
        (r) => !lowerApproved.includes(r.col.toLowerCase())
      );
    }
  }

  return { ...req };
}

/** Deny an access request by id. */
export function denyRequest(requestId) {
  const req = _requests.find((r) => r.id === requestId);
  if (!req) return null;
  req.status = "denied";
  req.resolvedAt = new Date();
  return { ...req };
}

/** Reset all requests and restriction indices to boot state. */
export function resetRequests() {
  _requests = [
    {
      id: 1001,
      from: "Marketing Team",
      columns: ["cost", "ad_spend"],
      reason: "Need cost data to calculate ROI for campaigns",
      status: "pending",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      id: 1002,
      from: "HR Team",
      columns: ["revenue"],
      reason: "Needed for executive compensation benchmarking",
      status: "pending",
      timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000),
    },
    {
      id: 1003,
      from: "Finance Team",
      columns: ["nps"],
      reason: "Required for quarterly business review dashboard",
      status: "approved",
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  ];
  _nextId = 2000;

  for (const [role, config] of Object.entries(ROLE_PERMISSIONS)) {
    _restrictionIndex[role] = new Map(
      config.restricted.map(({ col, reason }) => [col.toLowerCase(), reason])
    );
  }
}

/* ═══════════════════════════════════════════════════════════
   §5  INTROSPECTION HELPERS
═══════════════════════════════════════════════════════════ */

export function getAllPermissions() {
  return JSON.parse(JSON.stringify(ROLE_PERMISSIONS));
}

export function partitionColumns(role, datasetColumns) {
  if (role === "Owner" || !ROLE_PERMISSIONS[role]) {
    return { allowed: datasetColumns, blocked: [] };
  }

  const index = _restrictionIndex[role];
  const allowed = [];
  const blocked = [];

  for (const col of datasetColumns) {
    const reason = index.get(col.toLowerCase());
    if (reason !== undefined) {
      blocked.push({ col, reason });
    } else {
      allowed.push(col);
    }
  }

  return { allowed, blocked };
}
