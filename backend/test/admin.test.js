import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

function adminDb({ role = "admin", changes = 1 } = {}) {
  const queries = [];
  const DB = {
    prepare(sql) {
      const statement = { sql, values: [] };
      queries.push(statement);
      return { bind(...values) {
        statement.values = values;
        return {
          all: async () => ({ results: [{ id: "r-1", complainantEmail: "private@example.com" }] }),
          first: async () => sql.includes("FROM sessions s") ? { id: "admin-1", email: "admin@example.com", role } : null,
          run: async () => ({ success: true, meta: { changes } }),
        };
      } };
    },
  };
  return { DB, queries };
}

function request(path, { method = "GET", body } = {}) {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${"a".repeat(43)}`, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.6" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("admin queues require an admin role", async () => {
  const customer = await worker.fetch(request("/api/admin/reviews"), { DB: adminDb({ role: "customer" }).DB });
  assert.equal(customer.status, 403);
  assert.deepEqual(await customer.json(), { error: "admin_account_required" });
});

test("admin review queue includes private contact data and status filter is bound", async () => {
  const { DB, queries } = adminDb();
  const response = await worker.fetch(request("/api/admin/reviews?status=pending"), { DB });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.reviews[0].complainantEmail, "private@example.com");
  assert.match(queries.at(-1).sql, /review_private_details/);
  assert.deepEqual(queries.at(-1).values, ["pending", "pending"]);
});

test("admin can publish or soft-delete reviews with a moderation audit record", async () => {
  const { DB, queries } = adminDb();
  const published = await worker.fetch(request("/api/admin/reviews/r-1", { method: "POST", body: { action: "publish", reason: "Reviewed" } }), { DB });
  assert.equal(published.status, 200);
  assert.deepEqual(await published.json(), { review: { id: "r-1", status: "published" } });
  const update = queries.find(({ sql }) => sql.startsWith("UPDATE reviews"));
  assert.equal(update.values[0], "published");
  assert.ok(queries.some(({ sql, values }) => sql.includes("INSERT INTO moderation_actions") && values.includes("publish")));

  const deleted = await worker.fetch(request("/api/admin/reviews/r-1", { method: "POST", body: { action: "delete" } }), { DB });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).review.status, "deleted");
  assert.match(queries.find(({ sql }) => sql.startsWith("UPDATE reviews") && sql.includes("deleted_at")).sql, /deleted_at/);
});

test("admin can approve, hide, and delete business profiles", async () => {
  const { DB, queries } = adminDb();
  const response = await worker.fetch(request("/api/admin/businesses/b-1", { method: "POST", body: { action: "approve" } }), { DB });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { business: { id: "b-1", status: "approved" } });
  const update = queries.find(({ sql }) => sql.startsWith("UPDATE businesses"));
  assert.equal(update.values[0], "approved");
  assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO moderation_actions")));
});

test("admin routes reject invalid actions, invalid filters and unsupported methods", async () => {
  const { DB } = adminDb();
  const action = await worker.fetch(request("/api/admin/reviews/r-1", { method: "POST", body: { action: "purge" } }), { DB });
  assert.equal(action.status, 400);
  const filter = await worker.fetch(request("/api/admin/reviews?status=anything"), { DB });
  assert.equal(filter.status, 400);
  const method = await worker.fetch(request("/api/admin/reviews", { method: "DELETE" }), { DB });
  assert.equal(method.status, 405);
});
