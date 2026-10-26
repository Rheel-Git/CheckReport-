import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const env = { APP_ENV: "preview", ALLOWED_ORIGINS: "https://rheel-git.github.io,http://localhost:8080" };

function databaseFixture({ businessRows = [], business = null, reviewRows = [] } = {}) {
  const queries = [];
  return { queries, DB: { prepare(sql) { return { bind(...values) {
    queries.push({ sql, values });
    return {
      all: async () => ({ results: sql.includes("FROM businesses b") ? businessRows : reviewRows }),
      first: async () => sql.includes("WHERE b.slug = ?") ? business : { ok: 1 },
    };
  }, first: async () => ({ ok: 1 }) }; } } };
}

test("health endpoint returns service status to the configured frontend", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/api/health", { headers: { Origin: "https://rheel-git.github.io" } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://rheel-git.github.io");
  assert.deepEqual(await response.json(), { status: "ok", service: "checkreport-api", environment: "preview" });
});

test("unlisted origins do not receive CORS permission", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/api/health", { headers: { Origin: "https://untrusted.example" } }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight lists the supported methods and headers for an allowed origin", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/api/reviews", { method: "OPTIONS", headers: { Origin: "https://rheel-git.github.io" } }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, Authorization");
});

test("readiness stays unavailable until D1 is bound", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/api/ready"), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "not_ready", reason: "database_unavailable" });
});

test("readiness checks the database binding", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/api/ready"), { ...env, DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ready" });
});

test("unknown endpoints and unsupported methods fail closed", async () => {
  const unknown = await worker.fetch(new Request("https://api.example.test/api/private-data"), env);
  const wrongMethod = await worker.fetch(new Request("https://api.example.test/api/health", { method: "POST" }), env);
  assert.equal(unknown.status, 404);
  assert.equal(wrongMethod.status, 405);
});

test("business search returns approved public fields and bounds the page size", async () => {
  const db = databaseFixture({ businessRows: [{ id: "b-1", name: "Acme Repairs", slug: "acme-repairs", reviewCount: 2, averageRating: 4.5 }] });
  const response = await worker.fetch(new Request("https://api.example.test/api/businesses?q=acme_%&limit=999"), { ...env, ...db });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.businesses[0].name, "Acme Repairs");
  assert.equal(db.queries[0].values.at(-1), 50);
  assert.equal(db.queries[0].values[0], "%acme\\_\\%%");
  assert.match(db.queries[0].sql, /b\.status = 'approved'/);
  assert.doesNotMatch(db.queries[0].sql, /contact_email|contact_phone|review_private_details/i);
});

test("business profile includes public reviews without private contact fields", async () => {
  const business = { id: "b-1", name: "Acme Repairs", slug: "acme-repairs", reviewCount: 1, averageRating: 5 };
  const review = { id: "r-1", businessName: "Acme Repairs", serviceBought: "Roof repair", rating: 5, displayName: "Jamie R.", location: "Lagos", experience: "They did a careful job.", isResolved: 0 };
  const db = databaseFixture({ business, reviewRows: [review] });
  const response = await worker.fetch(new Request("https://api.example.test/api/businesses/acme-repairs"), { ...env, ...db });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.business.slug, "acme-repairs");
  assert.deepEqual(result.reviews, [review]);
  assert.doesNotMatch(JSON.stringify(result), /email|phone|password|token/i);
  assert.equal(db.queries.length, 2);
  assert.ok(db.queries.every(({ sql }) => !/review_private_details|complainant_email|complainant_phone/i.test(sql)));
});

test("business profile hides unapproved and missing profiles", async () => {
  const db = databaseFixture({ business: null });
  const response = await worker.fetch(new Request("https://api.example.test/api/businesses/pending-profile"), { ...env, ...db });
  assert.equal(response.status, 404);
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /b\.status = 'approved'/);
});

test("review feed returns only published public review fields", async () => {
  const review = { id: "r-1", businessName: "Acme Repairs", serviceBought: "Roof repair", rating: 5, displayName: "Anonymous reviewer", location: "Abuja", experience: "Clear communication.", isResolved: 0 };
  const db = databaseFixture({ reviewRows: [review] });
  const response = await worker.fetch(new Request("https://api.example.test/api/reviews?q=acme&limit=1"), { ...env, ...db });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.reviews, [review]);
  assert.equal(db.queries[0].values[0], 1);
  assert.match(db.queries[0].sql, /r\.status IN \\('published', 'resolved'\\)/);
  assert.doesNotMatch(db.queries[0].sql, /review_private_details|complainant_email|complainant_phone/i);
});

test("public data endpoints return unavailable when D1 is not bound", async () => {
  const response = await worker.fetch(new Request("https://api.example.test/api/businesses"), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "database_unavailable" });
});
