import { describe, it, expect } from "vitest";
import { app, request, createUser } from "./helpers.js";

describe("POST /api/auth/signup", () => {
  it("creates a user and returns a JWT", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Tanish", email: "t@x.com", password: "Str0ng!Pass", role: "Owner" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "t@x.com", name: "Tanish", role: "Owner" });
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(50);
  });

  it("rejects invalid bodies with per-field error details", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "not-an-email", password: "weak" });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Validation failed");
    expect(res.body.error.details).toHaveProperty("name");
    expect(res.body.error.details).toHaveProperty("email");
    expect(res.body.error.details).toHaveProperty("password");
    expect(res.body.error.details).toHaveProperty("role");
  });

  it("returns 409 on duplicate email", async () => {
    await createUser({ email: "dup@x.com", name: "First", role: "Owner" });
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Second", email: "dup@x.com", password: "Str0ng!Pass", role: "Owner" });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/auth/login", () => {
  it("returns a token on correct credentials", async () => {
    await createUser({ email: "login@x.com", name: "Lo", role: "Owner" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@x.com", password: "Str0ng!Pass" });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });

  it("returns 401 on wrong password (without leaking which field is wrong)", async () => {
    await createUser({ email: "login2@x.com", name: "Lo", role: "Owner" });
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: "login2@x.com", password: "BadGuess!" });

    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@x.com", password: "BadGuess!" });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    // Same message for both → prevents user enumeration
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });
});

describe("GET /api/auth/me", () => {
  it("returns the authenticated user", async () => {
    const { token } = await createUser({ email: "me@x.com", name: "Me", role: "HR Team" });
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "me@x.com", role: "HR Team" });
  });

  it("rejects requests without a bearer token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects malformed tokens", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });
});
