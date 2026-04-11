/**
 * accessControl.js — Role-Based Column-Level Access Control
 *
 * Responsibilities:
 *  1. Define role permissions with restricted column lists.
 *  2. Fast checkAccess(role, columns) before every query.
 *  3. Manage in-memory access request workflow (create / approve / deny).
 *
 * Design principles:
 *  - All column matching is case-insensitive.
 *  - Owner bypasses all restrictions.
 *  - Module is stateful: requests persist in memory until page reload or resetRequests().
 */

/* ═══════════════════════════════════════════════════════════
   §1  ROLE PERMISSION DEFINITIONS
═══════════════════════════════════════════════════════════ */

const ROLE_PERMISSIONS = {
  Owner: {
    restricted: [],   // Owner sees everything
    canApprove: true,
  },
  "Finance Team": {
    restricted: [
      { col: "Employee Salaries",   reason: "Sensitive HR data" },
      { col: "Headcount",           reason: "Sensitive HR data" },
      { col: "Customer Credit Cards", reason: "PII/PCI compliance" },
      { col: "NPS_Score",           reason: "Customer sentiment restricted" },
      { col: "text",                reason: "Raw feedback restricted" },
    ],
    canApprove: false,
  },
  "Marketing Team": {
    restricted: [
      { col: "Employee Salaries", reason: "Sensitive HR data" },
      { col: "Headcount",         reason: "Sensitive HR data" },
      { col: "Cost",              reason: "Confidential financial data" },
      { col: "Q1",                reason: "Quarterly financials restricted" },
      { col: "Q2",                reason: "Quarterly financials restricted" },
      { col: "Q3",                reason: "Quarterly financials restricted" },
      { col: "Q4",                reason: "Quarterly financials restricted" },
    ],
    canApprove: false,
  },
  "HR Team": {
    restricted: [
      { col: "Revenue",               reason: "Financial data restricted" },
      { col: "Ad_Spend",              reason: "Marketing budget restricted" },
      { col: "Cost",                  reason: "Confidential financial data" },
      { col: "Customer Credit Cards", reason: "PII/PCI compliance" },
    ],
    canApprove: false,
  },
};

/* ─── pre-compute lowercase lookup map per role for O(1) checks ─── */
// Maps: role → Map<lowercaseCol, reason>
const _restrictionIndex = {};
for (const [role, config] of Object.entries(ROLE_PERMISSIONS)) {
  _restrictionIndex[role] = new Map(
    config.restricted.map(({ col, reason }) => [col.toLowerCase(), reason])
  );
}

/* ═══════════════════════════════════════════════════════════
   §2  IN-MEMORY ACCESS REQUESTS STORE
═══════════════════════════════════════════════════════════ */

/**
 * Pre-populate with the same mock requests shown in the UI.
 * Status: "pending" | "approved" | "denied"
 */
let _requests = [
  {
    id: 1001,
    from: "Marketing Team",
    columns: ["Customer Email", "Purchase History"],
    reason: "Needed for targeted campaign segmentation",
    status: "pending",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
  },
  {
    id: 1002,
    from: "Finance Team",
    columns: ["Revenue by Region", "Profit Margins"],
    reason: "Required for quarterly P&L analysis",
    status: "pending",
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
  },
  {
    id: 1003,
    from: "HR Team",
    columns: ["Headcount Budget"],
    reason: "Annual headcount planning review",
    status: "approved",
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
  },
];

/** Auto-increment ID counter, starts after pre-populated seeds. */
let _nextId = 2000;

/* ═══════════════════════════════════════════════════════════
   §3  EXPORTED ACCESS CONTROL FUNCTIONS
═══════════════════════════════════════════════════════════ */

/**
 * Check whether a role can access all of the required columns.
 * Called before EVERY query — must be fast (O(n) on requiredColumns).
 *
 * @param {string}   role            — One of the defined role names
 * @param {string[]} requiredColumns — Column names that will be accessed
 * @returns {{ allowed: boolean, blockedColumns: { col: string, reason: string }[] }}
 */
export function checkAccess(role, requiredColumns) {
  // Owner bypasses all restrictions
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
 * Return the restricted column list for a role.
 * Returns an empty array for Owner or unknown roles.
 *
 * @param {string} role
 * @returns {{ col: string, reason: string }[]}
 */
export function getRestrictions(role) {
  return ROLE_PERMISSIONS[role]?.restricted ?? [];
}

/**
 * Return all defined role names.
 * @returns {string[]}
 */
export function getRoles() {
  return Object.keys(ROLE_PERMISSIONS);
}

/**
 * Return whether a role can approve access requests.
 * Only Owner returns true by default.
 *
 * @param {string} role
 * @returns {boolean}
 */
export function canApprove(role) {
  return ROLE_PERMISSIONS[role]?.canApprove ?? false;
}

/* ═══════════════════════════════════════════════════════════
   §4  ACCESS REQUEST WORKFLOW
═══════════════════════════════════════════════════════════ */

/**
 * Create and store a new access request.
 *
 * @param {string}   fromRole  — Role making the request
 * @param {string[]} columns   — Columns being requested
 * @param {string}   [reason]  — Optional plain-text justification
 * @returns {{ id, from, columns, reason, status, timestamp }}
 */
export function createAccessRequest(fromRole, columns, reason = "") {
  const request = {
    id: _nextId++,
    from: fromRole,
    columns: [].concat(columns),
    reason,
    status: "pending",
    timestamp: new Date(),
  };
  _requests.push(request);
  return { ...request }; // return a copy
}

/**
 * Return all access requests (copy of the array).
 * @returns {object[]}
 */
export function getAccessRequests() {
  return _requests.map((r) => ({ ...r }));
}

/**
 * Return only pending access requests.
 * @returns {object[]}
 */
export function getPendingRequests() {
  return _requests.filter((r) => r.status === "pending").map((r) => ({ ...r }));
}

/**
 * Approve an access request by id.
 * @param {number} requestId
 * @returns {{ ...request } | null}  null if not found
 */
export function approveRequest(requestId) {
  const req = _requests.find((r) => r.id === requestId);
  if (!req) return null;
  req.status = "approved";
  req.resolvedAt = new Date();
  return { ...req };
}

/**
 * Deny an access request by id.
 * @param {number} requestId
 * @returns {{ ...request } | null}  null if not found
 */
export function denyRequest(requestId) {
  const req = _requests.find((r) => r.id === requestId);
  if (!req) return null;
  req.status = "denied";
  req.resolvedAt = new Date();
  return { ...req };
}

/**
 * Reset all requests back to the pre-populated seed data.
 * Useful for testing and dev resets.
 */
export function resetRequests() {
  _requests = [
    {
      id: 1001,
      from: "Marketing Team",
      columns: ["Customer Email", "Purchase History"],
      reason: "Needed for targeted campaign segmentation",
      status: "pending",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      id: 1002,
      from: "Finance Team",
      columns: ["Revenue by Region", "Profit Margins"],
      reason: "Required for quarterly P&L analysis",
      status: "pending",
      timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000),
    },
    {
      id: 1003,
      from: "HR Team",
      columns: ["Headcount Budget"],
      reason: "Annual headcount planning review",
      status: "approved",
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  ];
  _nextId = 2000;
}

/* ═══════════════════════════════════════════════════════════
   §5  INTROSPECTION HELPERS  (useful for UI and tests)
═══════════════════════════════════════════════════════════ */

/**
 * Return the full ROLE_PERMISSIONS definition (read-only copy).
 * Useful for rendering restriction lists in the UI.
 * @returns {object}
 */
export function getAllPermissions() {
  return JSON.parse(JSON.stringify(ROLE_PERMISSIONS));
}

/**
 * Given a role and a dataset's column list, return two arrays:
 *   allowed:  columns accessible to the role
 *   blocked:  columns blocked with reasons
 *
 * @param {string}   role
 * @param {string[]} datasetColumns
 * @returns {{ allowed: string[], blocked: { col: string, reason: string }[] }}
 */
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
