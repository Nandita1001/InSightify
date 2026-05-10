import { describe, it, expect } from "vitest";
import { app, request, createUser } from "./helpers.js";

const SAMPLE_CSV = `month,product,units_sold,revenue
Jan,Widget,120,12000
Jan,Gadget,80,9600
`;

/* ─── Permissions admin ───────────────────────────────────────────────── */

describe("Admin: permissions", () => {
  it("rejects non-Owner with 403", async () => {
    const hr = await createUser({ email: "hr@x.com", name: "H", role: "HR Team" });
    const res = await hr.auth(request(app).get("/api/admin/permissions"));
    expect(res.status).toBe(403);
  });

  it("Owner sees the seeded role matrix", async () => {
    const owner = await createUser({ email: "o@x.com", name: "O", role: "Owner" });
    const res = await owner.auth(request(app).get("/api/admin/permissions"));
    expect(res.status).toBe(200);
    const roleNames = res.body.roles.map((r) => r.role);
    expect(roleNames).toEqual(expect.arrayContaining(["Owner", "Finance Team", "Marketing Team", "HR Team"]));

    const hrRow = res.body.roles.find((r) => r.role === "HR Team");
    expect(hrRow.restricted.map((r) => r.col)).toContain("revenue");
  });

  it("Owner edits HR's restrictions and the change takes effect immediately", async () => {
    const owner = await createUser({ email: "o2@x.com", name: "O", role: "Owner" });
    const hr    = await createUser({ email: "hr2@x.com", name: "H", role: "HR Team" });

    // Before: HR can't see ad_spend
    const before = await hr.auth(request(app).get("/api/access/me/restrictions"));
    expect(before.body.restrictions.map((r) => r.col)).toContain("ad_spend");

    // Owner removes ad_spend from HR's restrictions
    const update = await owner.auth(
      request(app).put("/api/admin/permissions/HR Team").send({
        restricted: [
          { col: "revenue", reason: "still restricted" },
          // ad_spend dropped
        ],
        canApprove: false,
      })
    );
    expect(update.status).toBe(200);

    // After: ad_spend no longer in HR's restrictions (no redeploy)
    const after = await hr.auth(request(app).get("/api/access/me/restrictions"));
    const cols = after.body.restrictions.map((r) => r.col);
    expect(cols).not.toContain("ad_spend");
    expect(cols).toContain("revenue");
  });

  it("rejects unknown roles with 400", async () => {
    const owner = await createUser({ email: "o3@x.com", name: "O", role: "Owner" });
    const res = await owner.auth(
      request(app).put("/api/admin/permissions/Aliens").send({ restricted: [], canApprove: false })
    );
    expect(res.status).toBe(400);
  });
});

/* ─── Dictionary admin ────────────────────────────────────────────────── */

describe("Admin: dictionary", () => {
  it("rejects non-Owner", async () => {
    const hr = await createUser({ email: "hr@x.com", name: "H", role: "HR Team" });
    const res = await hr.auth(request(app).get("/api/admin/dictionary"));
    expect(res.status).toBe(403);
  });

  it("supports CRUD on entries", async () => {
    const owner = await createUser({ email: "o@x.com", name: "O", role: "Owner" });

    // Initial list = seeded defaults
    const initial = await owner.auth(request(app).get("/api/admin/dictionary"));
    expect(initial.body.entries.length).toBeGreaterThan(0);

    // Create
    const created = await owner.auth(
      request(app).post("/api/admin/dictionary").send({
        name: "lifetime_value",
        def: "Total revenue from a customer over their entire relationship",
        scope: "global",
      })
    );
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("lifetime_value");
    const id = created.body.id;

    // Update
    const updated = await owner.auth(
      request(app).put(`/api/admin/dictionary/${id}`).send({ def: "LTV (revised)" })
    );
    expect(updated.status).toBe(200);
    expect(updated.body.def).toBe("LTV (revised)");

    // Delete
    const del = await owner.auth(request(app).delete(`/api/admin/dictionary/${id}`));
    expect(del.status).toBe(204);
  });
});

/* ─── Dataset visibility (allowedRoles) ───────────────────────────────── */

describe("Admin: dataset visibility", () => {
  it("rejects non-Owner attempts to change visibility", async () => {
    const hr = await createUser({ email: "hr@x.com", name: "H", role: "HR Team" });
    const own = await createUser({ email: "o@x.com", name: "O", role: "Owner" });

    const upload = await own.auth(
      request(app).post("/api/datasets").attach("file", Buffer.from(SAMPLE_CSV), "a.csv")
    );

    const res = await hr.auth(
      request(app).patch(`/api/admin/datasets/${upload.body.dataset.id}/visibility`).send({
        source: "company",
      })
    );
    expect(res.status).toBe(403);
  });

  it("Owner promotes an upload to company-wide; HR then sees it", async () => {
    const owner = await createUser({ email: "owner@x.com", name: "O", role: "Owner" });
    const hr    = await createUser({ email: "hr2@x.com",   name: "H", role: "HR Team" });

    // Owner uploads
    const upload = await owner.auth(
      request(app).post("/api/datasets").attach("file", Buffer.from(SAMPLE_CSV), "shared.csv")
    );
    const datasetId = upload.body.dataset.id;

    // HR can NOT see Owner's user-source upload
    const beforeList = await hr.auth(request(app).get("/api/datasets"));
    expect(beforeList.body.datasets.find((d) => d.id === datasetId)).toBeUndefined();

    // Owner promotes to company
    const promote = await owner.auth(
      request(app).patch(`/api/admin/datasets/${datasetId}/visibility`).send({
        source: "company",
      })
    );
    expect(promote.status).toBe(200);
    expect(promote.body.source).toBe("company");

    // HR now sees it (company-source, no allowedRoles restriction)
    const afterList = await hr.auth(request(app).get("/api/datasets"));
    expect(afterList.body.datasets.find((d) => d.id === datasetId)).toBeDefined();
  });

  it("Owner restricts a company dataset to specific roles; HR loses access", async () => {
    const owner = await createUser({ email: "o@x.com", name: "O", role: "Owner" });
    const hr    = await createUser({ email: "h@x.com", name: "H", role: "HR Team" });
    const fin   = await createUser({ email: "f@x.com", name: "F", role: "Finance Team" });

    const upload = await owner.auth(
      request(app).post("/api/datasets").attach("file", Buffer.from(SAMPLE_CSV), "fin.csv")
    );
    const datasetId = upload.body.dataset.id;

    // Promote to company AND restrict to Finance only
    await owner.auth(
      request(app).patch(`/api/admin/datasets/${datasetId}/visibility`).send({
        source: "company",
        allowedRoles: ["Owner", "Finance Team"],
      })
    );

    // HR doesn't see it
    const hrList = await hr.auth(request(app).get("/api/datasets"));
    expect(hrList.body.datasets.find((d) => d.id === datasetId)).toBeUndefined();

    // Finance sees it
    const finList = await fin.auth(request(app).get("/api/datasets"));
    expect(finList.body.datasets.find((d) => d.id === datasetId)).toBeDefined();

    // Owner always sees it (bypass for company datasets)
    const ownerList = await owner.auth(request(app).get("/api/datasets"));
    expect(ownerList.body.datasets.find((d) => d.id === datasetId)).toBeDefined();
  });

  it("HR cannot GET a company dataset they're not in allowedRoles for", async () => {
    const owner = await createUser({ email: "o@x.com", name: "O", role: "Owner" });
    const hr    = await createUser({ email: "h@x.com", name: "H", role: "HR Team" });

    const upload = await owner.auth(
      request(app).post("/api/datasets").attach("file", Buffer.from(SAMPLE_CSV), "secret.csv")
    );
    const datasetId = upload.body.dataset.id;

    await owner.auth(
      request(app).patch(`/api/admin/datasets/${datasetId}/visibility`).send({
        source: "company",
        allowedRoles: ["Owner"],
      })
    );

    const res = await hr.auth(request(app).get(`/api/datasets/${datasetId}`));
    expect(res.status).toBe(404);   // 404 not 403 — don't leak existence
  });
});
