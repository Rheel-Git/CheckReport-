import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

function mockDb(user, customerReviews = [], businesses = [], businessReviews = []) {
  return {
    prepare(sql) {
      let values = [];
      return {
        bind(...bound) {
          values = bound;
          return {
            first: async () => sql.includes("FROM sessions s") ? user : null,
            all: async () => {
              if (sql.includes("FROM reviews r") && sql.includes("WHERE r.user_id = ?")) {
                assert.equal(values[0], user.id);
                return { results: customerReviews };
              }
              if (sql.includes("FROM businesses") && sql.includes("owner_user_id = ?")) {
                assert.equal(values[0], user.id);
                return { results: businesses };
              }
              if (sql.includes("JOIN businesses b") && sql.includes("owner_user_id = ?")) {
                assert.equal(values[0], user.id);
                return { results: businessReviews };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function request(path, token = "A".repeat(43)) {
  return new Request(`https://api.example.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

test("account dashboard requires an authenticated session", async () => {
  const response = await worker.fetch(request("/api/account/dashboard", null), { DB: mockDb(null) });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

test("customer dashboard returns only the signed-in customer's review records", async () => {
  const user = { id: "customer-1", email: "customer@example.com", display_name: "Customer", role: "customer" };
  const ownReview = { id: "review-1", businessName: "Local Shop", rating: 4, status: "pending", phone: "+2348000000000" };
  const response = await worker.fetch(request("/api/account/dashboard"), { DB: mockDb(user, [ownReview]) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.email, "customer@example.com");
  assert.deepEqual(body.reviews, [ownReview]);
});

test("customer dashboard denies non-customer roles", async () => {
  const admin = { id: "admin-1", email: "admin@example.com", display_name: "Admin", role: "admin" };
  const response = await worker.fetch(request("/api/account/dashboard"), { DB: mockDb(admin) });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "customer_account_required" });
});

test("business dashboard returns only profiles and reviews owned by the signed-in business", async () => {
  const user = { id: "business-1", email: "owner@example.com", display_name: "Owner", role: "business" };
  const profile = { id: "b-1", name: "Local Shop", status: "pending", contactEmail: "owner@example.com" };
  const review = { id: "r-1", businessId: "b-1", status: "published", rating: 5 };
  const response = await worker.fetch(request("/api/businesses/mine"), { DB: mockDb(user, [], [profile], [review]) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.businesses, [profile]);
  assert.deepEqual(body.reviews, [review]);
});

test("business dashboard denies customer roles", async () => {
  const customer = { id: "customer-1", email: "customer@example.com", display_name: "Customer", role: "customer" };
  const response = await worker.fetch(request("/api/businesses/mine"), { DB: mockDb(customer) });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "business_account_required" });
});
