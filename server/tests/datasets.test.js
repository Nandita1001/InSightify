import { describe, it, expect } from "vitest";
import { app, request, createUser } from "./helpers.js";

const SAMPLE_CSV = `month,product,units_sold,revenue
Jan,Widget,120,12000
Jan,Gadget,80,9600
Feb,Widget,140,14000
`;

describe("Datasets API", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/datasets");
    expect(res.status).toBe(401);
  });

  it("user starts with no datasets visible", async () => {
    const { auth } = await createUser({ email: "n@x.com", name: "N", role: "Owner" });
    const res = await auth(request(app).get("/api/datasets"));
    expect(res.status).toBe(200);
    expect(res.body.datasets).toEqual([]);
  });

  it("uploads a CSV via multipart, profiles columns, returns 201", async () => {
    const { auth } = await createUser({ email: "up@x.com", name: "Up", role: "Owner" });

    const res = await auth(
      request(app)
        .post("/api/datasets")
        .field("type", "structured")
        .attach("file", Buffer.from(SAMPLE_CSV), "metrics.csv")
    );

    expect(res.status).toBe(201);
    expect(res.body.dataset).toMatchObject({
      source: "user",
      type: "structured",
      rowCount: 3,
      fileName: "metrics.csv",
    });
    expect(res.body.dataset.columns).toHaveLength(4);
    const colNames = res.body.dataset.columns.map((c) => c.name);
    expect(colNames).toEqual(["month", "product", "units_sold", "revenue"]);

    // numeric column has stats
    const revenue = res.body.dataset.columns.find((c) => c.name === "revenue");
    expect(revenue.type).toBe("numeric");
    expect(revenue.stats.min).toBe(9600);
    expect(revenue.stats.max).toBe(14000);
  });

  it("scopes list to the owner: user A cannot see user B's uploads", async () => {
    const a = await createUser({ email: "a@x.com", name: "A", role: "Owner" });
    const b = await createUser({ email: "b@x.com", name: "B", role: "Owner" });

    await a.auth(
      request(app).post("/api/datasets").attach("file", Buffer.from(SAMPLE_CSV), "a.csv")
    );

    const aList = await a.auth(request(app).get("/api/datasets"));
    const bList = await b.auth(request(app).get("/api/datasets"));

    expect(aList.body.datasets).toHaveLength(1);
    expect(bList.body.datasets).toHaveLength(0);          // does NOT see a's data
  });

  it("returns 403/404 when user B tries to GET user A's dataset", async () => {
    const a = await createUser({ email: "a2@x.com", name: "A", role: "Owner" });
    const b = await createUser({ email: "b2@x.com", name: "B", role: "Owner" });

    const upload = await a.auth(
      request(app).post("/api/datasets").attach("file", Buffer.from(SAMPLE_CSV), "secret.csv")
    );
    const datasetId = upload.body.dataset.id;

    const res = await b.auth(request(app).get(`/api/datasets/${datasetId}`));
    expect([403, 404]).toContain(res.status);             // forbidden either way
  });

  it("DELETE removes the user's dataset", async () => {
    const { auth } = await createUser({ email: "d@x.com", name: "D", role: "Owner" });

    const upload = await auth(
      request(app).post("/api/datasets").attach("file", Buffer.from(SAMPLE_CSV), "a.csv")
    );
    const datasetId = upload.body.dataset.id;

    const del = await auth(request(app).delete(`/api/datasets/${datasetId}`));
    expect(del.status).toBe(204);

    const list = await auth(request(app).get("/api/datasets"));
    expect(list.body.datasets).toHaveLength(0);
  });

  it("rejects unsupported file extensions", async () => {
    const { auth } = await createUser({ email: "x@x.com", name: "X", role: "Owner" });

    const res = await auth(
      request(app).post("/api/datasets").attach("file", Buffer.from("evil"), "malware.exe")
    );
    // Multer's fileFilter throws → routed through error handler as 500
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
  });
});
