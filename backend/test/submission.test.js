import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

function submissionDb({ role = "customer", approvedBusiness = true, attemptCount = 1 } = {}) {
  const statements = [];
  const user = { id: "user-1", email: "customer@example.com", display_name: "Jamie R.", role };
  const DB = {
    prepare(sql) {
      const statement = { sql, values: [] };
      statements.push(statement);
      return {
        bind(...values) {
          statement.values = values;
          return {
            sql,
            values,
            first: async () => {
              if (sql.includes("FROM sessions s")) return user;
              if (sql.includes("SELECT attempt_count")) return { attempt_count: attemptCount };
              if (sql.includes("FROM businesses WHERE id")) return approvedBusiness ? { id: "business-1" } : null;
              return null;
            },
            run: async () => ({ success: true }),
          };
        },
      };
    },
    batch: async () => [],
  };
  return { DB, statements };
}

function post(path, body) {
  return new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${"a".repeat(43)}`, "CF-Connecting-IP": "192.0.2.4" },
    body: JSON.stringify(body),
  });
}

const env = { ALLOWED_ORIGINS: "" };

test("review submission requires an authenticated customer account", async () => {
  const unauthenticated = await worker.fetch(new Request("https://api.example.test/api/reviews", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }), { ...env, DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } });
  assert.equal(unauthenticated.status, 401);

  const { DB } = submissionDb({ role: "business" });
  const wrongRole = await worker.fetch(post("/api/reviews", {}), { ...env, DB });
  assert.equal(wrongRole.status, 403);
});

test("review submission stores private contacts separately and returns no personal information", async () => {
  const { DB, statements } = submissionDb();
  const response = await worker.fetch(post("/api/reviews", {
    providerName: "Northstar Repairs", serviceBought: "Kitchen installation", providerWebsite: "northstar.example",
    providerPhone: "+234 800 123 4567", providerEmail: "vendor@example.com", complainantPhone: "+234 800 111 2233",
    triedToResolve: true, experience: "The team missed two agreed appointments and has not completed the repair.",
    rating: 2, isAnonymous: false, location: "Lagos",
  }), { ...env, DB });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.equal(data.review.status, "pending");
  assert.equal(Object.hasOwn(data.review, "email"), false);
  assert.equal(statements.filter(({ sql }) => sql.includes("INSERT INTO reviews")).length, 1);
  const privateInsert = statements.find(({ sql }) => sql.includes("INSERT INTO review_private_details"));
  assert.ok(privateInsert);
  assert.deepEqual(privateInsert.values.slice(1), ["customer@example.com", "+234 800 111 2233", "vendor@example.com", "+234 800 123 4567"]);
  assert.match(statements.find(({ sql }) => sql.includes("INSERT INTO reviews")).sql, /'pending'/);
});

test("review cannot be attached to an unapproved or unknown business", async () => {
  const { DB } = submissionDb({ approvedBusiness: false });
  const response = await worker.fetch(post("/api/reviews", {
    providerName: "Northstar Repairs", serviceBought: "Kitchen installation", triedToResolve: false,
    experience: "The team missed two agreed appointments and did not complete the repair.",
    rating: 2, isAnonymous: true, location: "Lagos", businessId: "business-1",
  }), { ...env, DB });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "business_not_approved_or_not_found" });
});

test("business account can create a pending profile without exposing contact details", async () => {
  const { DB, statements } = submissionDb({ role: "business" });
  const response = await worker.fetch(post("/api/businesses", {
    name: "Northstar Home Repairs", serviceType: "Home services", location: "Lagos",
    website: "https://northstar.example", contactPhone: "+234 800 123 4567", contactEmail: "public@example.com",
  }), { ...env, DB });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.equal(data.business.status, "pending");
  assert.equal(data.business.name, "Northstar Home Repairs");
  assert.doesNotMatch(JSON.stringify(data), /public@example.com|123 4567/);
  const insert = statements.find(({ sql }) => sql.includes("INSERT INTO businesses"));
  assert.ok(insert);
  assert.match(insert.sql, /'pending'/);
  assert.equal(insert.values.at(-1), "public@example.com");
});

test("invalid fields, oversized bodies and submission method mismatches are rejected", async () => {
  const { DB } = submissionDb();
  const invalid = await worker.fetch(post("/api/reviews", { providerName: "", rating: 6 }), { ...env, DB });
  assert.equal(invalid.status, 400);

  const large = await worker.fetch(new Request("https://api.example.test/api/reviews", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${"a".repeat(43)}` },
    body: JSON.stringify({ experience: "x".repeat(25 * 1024) }),
  }), { ...env, DB });
  assert.equal(large.status, 413);

  const wrongMethod = await worker.fetch(new Request("https://api.example.test/api/businesses", { method: "PUT" }), { ...env, DB });
  assert.equal(wrongMethod.status, 405);
});

test("submission rate limits are enforced", async () => {
  const { DB } = submissionDb({ attemptCount: 6 });
  const response = await worker.fetch(post("/api/reviews", {}), { ...env, DB });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "rate_limited" });
});
