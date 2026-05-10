import { describe, it, expect } from "vitest";
import { app, request, createUser } from "./helpers.js";

describe("GET /api/access/me/restrictions", () => {
  it("returns empty for Owner", async () => {
    const { auth } = await createUser({ email: "o@x.com", name: "O", role: "Owner" });
    const res = await auth(request(app).get("/api/access/me/restrictions"));
    expect(res.status).toBe(200);
    expect(res.body.restrictions).toEqual([]);
  });

  it("returns role-baseline restrictions for HR Team", async () => {
    const { auth } = await createUser({ email: "h@x.com", name: "H", role: "HR Team" });
    const res = await auth(request(app).get("/api/access/me/restrictions"));
    expect(res.status).toBe(200);
    expect(res.body.restrictions.length).toBeGreaterThan(0);
    const cols = res.body.restrictions.map((r) => r.col);
    expect(cols).toContain("revenue");
    expect(cols).toContain("nps");
  });
});

describe("Access requests workflow", () => {
  it("HR creates → Owner approves → restrictions update", async () => {
    const owner = await createUser({ email: "owner@x.com", name: "O", role: "Owner" });
    const hr    = await createUser({ email: "hr@x.com",    name: "H", role: "HR Team" });

    // Step 1: HR creates request
    const createRes = await hr.auth(
      request(app).post("/api/access/requests").send({
        columns: ["revenue", "cost"],
        reason: "test",
      })
    );
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("pending");
    const reqId = createRes.body.id;

    // Step 2: Non-owner cannot approve own request
    const selfApprove = await hr.auth(
      request(app).patch(`/api/access/requests/${reqId}`).send({ status: "approved" })
    );
    expect(selfApprove.status).toBe(403);

    // Step 3: Owner approves
    const ownerApprove = await owner.auth(
      request(app).patch(`/api/access/requests/${reqId}`).send({ status: "approved" })
    );
    expect(ownerApprove.status).toBe(200);
    expect(ownerApprove.body.status).toBe("approved");

    // Step 4: HR's effective restrictions no longer include revenue or cost
    const after = await hr.auth(request(app).get("/api/access/me/restrictions"));
    const cols = after.body.restrictions.map((r) => r.col);
    expect(cols).not.toContain("revenue");
    expect(cols).not.toContain("cost");
  });

  it("returns 409 when re-resolving an already-resolved request", async () => {
    const owner = await createUser({ email: "owner2@x.com", name: "O", role: "Owner" });
    const hr    = await createUser({ email: "hr2@x.com",    name: "H", role: "HR Team" });

    const created = await hr.auth(
      request(app).post("/api/access/requests").send({ columns: ["nps"] })
    );
    await owner.auth(
      request(app).patch(`/api/access/requests/${created.body.id}`).send({ status: "approved" })
    );

    const second = await owner.auth(
      request(app).patch(`/api/access/requests/${created.body.id}`).send({ status: "denied" })
    );
    expect(second.status).toBe(409);
  });

  it("dedupes a duplicate pending request for the same columns", async () => {
    const hr = await createUser({ email: "hr3@x.com", name: "H", role: "HR Team" });

    const first = await hr.auth(
      request(app).post("/api/access/requests").send({ columns: ["nps", "text"] })
    );
    const second = await hr.auth(
      request(app).post("/api/access/requests").send({ columns: ["text", "nps"] })  // reordered
    );
    expect(first.body.id).toBe(second.body.id);
  });

  it("scopes list: HR sees only their own, Owner sees all", async () => {
    const owner = await createUser({ email: "owner4@x.com", name: "O", role: "Owner" });
    const hrA   = await createUser({ email: "hrA@x.com",    name: "A", role: "HR Team" });
    const hrB   = await createUser({ email: "hrB@x.com",    name: "B", role: "HR Team" });

    await hrA.auth(request(app).post("/api/access/requests").send({ columns: ["nps"] }));
    await hrB.auth(request(app).post("/api/access/requests").send({ columns: ["text"] }));

    const aList = await hrA.auth(request(app).get("/api/access/requests"));
    const bList = await hrB.auth(request(app).get("/api/access/requests"));
    const oList = await owner.auth(request(app).get("/api/access/requests"));

    expect(aList.body.requests).toHaveLength(1);
    expect(bList.body.requests).toHaveLength(1);
    expect(oList.body.requests).toHaveLength(2);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/access/requests");
    expect(res.status).toBe(401);
  });
});
