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
      return new Response(null, {
        status: 204,
        headers: responseHeaders(request, env),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(request, env, {
        status: "ok",
        service: "checkreport-api",
        environment: env.APP_ENV || "unset",
      });
    }

    if (request.method === "GET" && url.pathname === "/api/ready") {
      if (!(await databaseReady(env))) {
        return json(request, env, {
          status: "not_ready",
          reason: "database_unavailable",
        }, 503);
      }

      return json(request, env, { status: "ready" });
    }

    if (url.pathname.startsWith("/api/") && request.method !== "GET") {
      return json(request, env, { error: "method_not_allowed" }, 405);
    }

    return json(request, env, { error: "not_found" }, 404);
  },
};
