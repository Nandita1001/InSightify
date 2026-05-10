import request from "supertest";
import { createApp } from "../src/app.js";

export const app = createApp();

const STRONG_PASSWORD = "Str0ng!Pass";

/**
 * Create a user via the signup endpoint and return { user, token, agent }.
 * `agent` is a supertest agent pre-configured with the Authorization header.
 */
export async function createUser({ email, name, role = "Owner" }) {
  const res = await request(app)
    .post("/api/auth/signup")
    .send({ name, email, password: STRONG_PASSWORD, role });

  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const { user, token } = res.body;
  return {
    user,
    token,
    auth: (req) => req.set("Authorization", `Bearer ${token}`),
  };
}

export { request };
