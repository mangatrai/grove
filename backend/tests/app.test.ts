import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp();

describe("app health", () => {
  it("returns ok from health endpoint", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});

describe("auth and rbac baseline", () => {
  it("returns token for seeded owner account", async () => {
    const response = await request(app).post("/auth/login").send({
      email: "owner@example.com",
      password: "ChangeMe123!"
    });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe("string");
  });

  it("blocks protected endpoint without token", async () => {
    const response = await request(app).get("/auth/me");

    expect(response.status).toBe(401);
  });
});
