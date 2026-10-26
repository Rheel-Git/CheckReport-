import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, hashToken, randomToken, verifyPassword } from "../src/auth-crypto.js";
import worker from "../src/index.js";

test("passwords are stored as salted PBKDF2 digests and verified", async () => {
  const encoded = await hashPassword("a sufficiently long test passphrase");
  assert.match(encoded, /^pbkdf2-sha256\$600000\$/);
  assert.equal(await verifyPassword("a sufficiently long test passphrase", encoded), true);
  assert.equal(await verifyPassword("a different long test passphrase", encoded), false);
  assert.equal(encoded.includes("a sufficiently long"), false);
});

test("password policy requires 15 characters and limits encoded bytes", async () => {
  await assert.rejects(hashPassword("too short"), /password_out_of_range/);
  await assert.rejects(hashPassword("é".repeat(129)), /password_out_of_range/);
});

test("session tokens are random opaque values and can be hashed", async () => {
  const first = randomToken();
  const second = randomToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.notEqual(await hashToken(first), first);
});

test("authentication routes fail closed when the database is unavailable", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "user@example.com", password: "a sufficiently long test passphrase" }),
  }), { ALLOWED_ORIGINS: "" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "database_unavailable" });
});

test("authentication route methods are explicit", async () => {
  const getLogin = await worker.fetch(new Request("https://api.example.test/api/auth/login"), { ALLOWED_ORIGINS: "" });
  const postMe = await worker.fetch(new Request("https://api.example.test/api/auth/me", { method: "POST" }), { ALLOWED_ORIGINS: "" });
  assert.equal(getLogin.status, 405);
  assert.equal(postMe.status, 405);
});

test("registration does not leave an account behind when email delivery is not configured", async () => {
  const statements = [];
  const DB = {
    prepare(sql) {
      const query = { sql, values: [] };
      statements.push(query);
      return {
        bind(...values) {
          query.values = values;
          return {
            first: async () => sql.includes("SELECT attempt_count") ? { attempt_count: 1 } : null,
            run: async () => ({ success: true }),
          };
        },
      };
    },
  };
  const response = await worker.fetch(new Request("https://api.example.test/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.10" },
    body: JSON.stringify({ email: "person@example.com", password: "a sufficiently long test passphrase", role: "customer" }),
  }), { DB, ALLOWED_ORIGINS: "" });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "email_delivery_unavailable" });
  assert.ok(statements.some(({ sql }) => sql.startsWith("DELETE FROM users")));
});
