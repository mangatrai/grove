import request from "supertest";
import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const app = buildApp();

const GROCERIES_ID = "30000000-0000-0000-0000-000000000004";

async function ownerToken(): Promise<string> {
  const login = await request(app).post("/auth/login").send({
    email: "owner@example.com",
    password: "ChangeMe123!"
  });
  expect(login.status).toBe(200);
  return login.body.token as string;
}

describe("PATCH /categories — household vs built-in", () => {
  it("allows owner to rename a built-in leaf and restore", async () => {
    const token = await ownerToken();
    const r1 = await request(app)
      .patch(`/categories/${GROCERIES_ID}`)
      .set("authorization", `Bearer ${token}`)
      .send({ name: "Groceries (edited)" });
    expect(r1.status).toBe(200);
    expect(r1.body.category.name).toBe("Groceries (edited)");
    const r2 = await request(app)
      .patch(`/categories/${GROCERIES_ID}`)
      .set("authorization", `Bearer ${token}`)
      .send({ name: "Groceries" });
    expect(r2.status).toBe(200);
    expect(r2.body.category.name).toBe("Groceries");
  });
});

describe("DELETE /categories — built-in", () => {
  it("returns 403 BUILTIN_READONLY for built-in category", async () => {
    const token = await ownerToken();
    const res = await request(app).delete(`/categories/${GROCERIES_ID}`).set("authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("BUILTIN_READONLY");
  });
});
