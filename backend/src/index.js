import { getBusiness, getPublicReview, listBusinesses, listPublicReviews } from "./public-api.js";
import { authMethodAllowed, handleAuth, isAuthPath } from "./auth.js";
import { handleSubmission, isSubmissionPath } from "./submission-api.js";
import { handleAdmin, isAdminPath } from "./admin-api.js";
import { handleAccount, isAccountPath } from "./account-api.js";

const DEFAULT_ALLOWED_METHODS = "GET, POST, OPTIONS";
const DEFAULT_ALLOWED_HEADERS = "Content-Type, Authorization";

function allowedOrigins(env) {
  return new Set(
    String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function responseHeaders(request, env) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");

  if (origin && allowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", DEFAULT_ALLOWED_METHODS);
    headers.set("Access-Control-Allow-Headers", DEFAULT_ALLOWED_HEADERS);
    headers.set("Access-Control-Max-Age", "600");
  }

  return headers;
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request, env),
  });
}

async function databaseReady(env) {
  if (!env.DB) return false;

  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    return row?.ok === 1;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(request, env) });
    }

    if (isAccountPath(url.pathname)) {
      if (request.method !== "GET") return json(request, env, { error: "method_not_allowed" }, 405);
      const result = await handleAccount(request, env, url.pathname);
      return json(request, env, result.body, result.status);
    }

    if (isAuthPath(url.pathname)) {
      if (!authMethodAllowed(url.pathname, request.method)) {
        return json(request, env, { error: "method_not_allowed" }, 405);
      }
      const result = await handleAuth(request, env, url.pathname);
      return json(request, env, result.body, result.status);
    }

    if (isSubmissionPath(url.pathname) && request.method === "POST") {
      const result = await handleSubmission(request, env, url.pathname);
      return json(request, env, result.body, result.status);
    }
    if (isSubmissionPath(url.pathname) && request.method !== "GET") {
      return json(request, env, { error: "method_not_allowed" }, 405);
    }

    if (isAdminPath(url.pathname)) {
      const result = await handleAdmin(request, env, url.pathname);
      return json(request, env, result.body, result.status);
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(request, env, { status: "ok", service: "checkreport-api", environment: env.APP_ENV || "unset" });
    }

    if (request.method === "GET" && url.pathname === "/api/ready") {
      if (!(await databaseReady(env))) {
        return json(request, env, { status: "not_ready", reason: "database_unavailable" }, 503);
      }
      return json(request, env, { status: "ready" });
    }

    if (request.method === "GET" && url.pathname === "/api/businesses") {
      if (!env.DB) return json(request, env, { error: "database_unavailable" }, 503);
      try { return json(request, env, await listBusinesses(request, env)); }
      catch { return json(request, env, { error: "service_unavailable" }, 503); }
    }

    const businessMatch = url.pathname.match(/^\/api\/businesses\/([a-z0-9-]+)$/i);
    if (request.method === "GET" && businessMatch) {
      if (!env.DB) return json(request, env, { error: "database_unavailable" }, 503);
      try {
        const result = await getBusiness(request, env, businessMatch[1]);
        return result ? json(request, env, result) : json(request, env, { error: "not_found" }, 404);
      } catch { return json(request, env, { error: "service_unavailable" }, 503); }
    }

    if (request.method === "GET" && url.pathname === "/api/reviews") {
      if (!env.DB) return json(request, env, { error: "database_unavailable" }, 503);
      try { return json(request, env, await listPublicReviews(request, env)); }
      catch { return json(request, env, { error: "service_unavailable" }, 503); }
    }

    const reviewMatch = url.pathname.match(/^\/api\/reviews\/([a-z0-9_-]{1,80})$/i);
    if (request.method === "GET" && reviewMatch) {
      if (!env.DB) return json(request, env, { error: "database_unavailable" }, 503);
      try {
        const result = await getPublicReview(env, reviewMatch[1]);
        return result ? json(request, env, result) : json(request, env, { error: "not_found" }, 404);
      } catch { return json(request, env, { error: "service_unavailable" }, 503); }
    }

    if (url.pathname.startsWith("/api/") && request.method !== "GET") {
      return json(request, env, { error: "method_not_allowed" }, 405);
    }
    return json(request, env, { error: "not_found" }, 404);
  },
};
