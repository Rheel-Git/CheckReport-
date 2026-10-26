import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const env = {
  APP_ENV: "preview",
  ALLOWED_ORIGINS: "https://rheel-git.github.io,http://localhost:8080",
};

test("health endpoint returns service status to the configured frontend", async () => {
  const request = new Request("https://api.example.test/api/health", {
    headers: { Origin: "https://rheel-git.github.io" },
  });
  const response = await worker.fetch(request, env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://rheel-git.github.io");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "checkreport-api",
    environment: "preview",
  });
});

test("unlisted origins do not receive CORS permission", async () => {
  const request = new Request("https://api.example.test/api/health", {
    headers: { Origin: "https://untrusted.example" },
  });
  const response = await worker.fetch(request, env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight lists the supported methods and headers for an allowed origin", async () => {
  const request = new Request("https://api.example.test/api/reviews", {
    method: "OPTIONS",
    headers: { Origin: "https://rheel-git.github.io" },
  });
  const response = await worker.fetch(request, env);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, Authorization");
});

test("readiness stays unavailable until D1 is bound", async () => {
  const request = new Request("https://api.example.test/api/ready");
  const response = await worker.fetch(request, env);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: "not_ready",
    reason: "database_unavailable",
  });
});

test("readiness checks the database binding", async () => {
  const readyEnv = {
    ...env,
    DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) },
  };
  const request = new Request("https://api.example.test/api/ready");
  const response = await worker.fetch(request, readyEnv);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ready" });
});

test("unknown endpoints and unsupported methods fail closed", async () => {
  const unknown = await worker.fetch(new Request("https://api.example.test/api/private-data"), env);
  const wrongMethod = await worker.fetch(new Request("https://api.example.test/api/health", { method: "POST" }), env);

  assert.equal(unknown.status, 404);
  assert.equal(wrongMethod.status, 405);
});
