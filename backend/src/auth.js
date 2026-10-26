import { hashPassword, hashToken, randomToken, verifyPassword } from "./auth-crypto.js";

const SESSION_HOURS = 12;
const VERIFY_HOURS = 24;
function id() {
  return crypto.randomUUID();
}

function isoAfter(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function publicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name || null, role: row.role };
}

async function requestData(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) return null;
  try { return await request.json(); } catch { return null; }
}

async function limited(request, env, scope, limit, windowSeconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const keyHash = await hashToken(`${scope}:${ip}`);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  await env.DB.prepare(`
    INSERT INTO auth_rate_limits(scope, key_hash, window_start, attempt_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(scope, key_hash) DO UPDATE SET
      window_start = excluded.window_start,
      attempt_count = CASE WHEN auth_rate_limits.window_start = excluded.window_start
        THEN auth_rate_limits.attempt_count + 1 ELSE 1 END
  `).bind(scope, keyHash, windowStart).run();
  const row = await env.DB.prepare("SELECT attempt_count FROM auth_rate_limits WHERE scope = ? AND key_hash = ?")
    .bind(scope, keyHash).first();
  return (row?.attempt_count || 0) > limit;
}

async function sendVerification(env, email, token) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.EMAIL_VERIFY_URL) return false;
  const link = `${env.EMAIL_VERIFY_URL}${env.EMAIL_VERIFY_URL.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: "Verify your CheckReport account",
      text: `Verify your CheckReport email by opening this link within 24 hours:\n\n${link}`,
    }),
  });
  return response.ok;
}

async function register(request, env) {
  const body = await requestData(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body?.password;
  const role = body?.role;
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim().slice(0, 120) : null;
  if (!validEmail(email) || !["customer", "business"].includes(role) || (displayName && !displayName.length)) {
    return { status: 400, body: { error: "invalid_registration" } };
  }
  try {
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) return { status: 202, body: { status: "check_email_if_account_is_new" } };
    const passwordHash = await hashPassword(password);
    const userId = id();
    await env.DB.prepare("INSERT INTO users(id, email, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, email, displayName, passwordHash, role).run();
    const token = randomToken();
    await env.DB.prepare("INSERT INTO auth_email_tokens(token_hash, user_id, purpose, expires_at) VALUES (?, ?, 'verify_email', ?)")
      .bind(await hashToken(token), userId, isoAfter(VERIFY_HOURS)).run();
    if (!(await sendVerification(env, email, token))) {
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
      return { status: 503, body: { error: "email_delivery_unavailable" } };
    }
    return { status: 202, body: { status: "check_email_if_account_is_new" } };
  } catch (error) {
    if (error?.cause?.message?.includes("password_out_of_range") || error?.message === "password_out_of_range") {
      return { status: 400, body: { error: "password_must_be_15_to_256_bytes" } };
    }
    if (/UNIQUE constraint failed: users\.email/i.test(error?.message || "")) {
      return { status: 202, body: { status: "check_email_if_account_is_new" } };
    }
    return { status: 503, body: { error: "service_unavailable" } };
  }
}

async function verifyEmail(request, env) {
  const body = await requestData(request);
  if (typeof body?.token !== "string" || body.token.length > 200) return { status: 400, body: { error: "invalid_token" } };
  const tokenHash = await hashToken(body.token);
  const entry = await env.DB.prepare(`SELECT user_id FROM auth_email_tokens
    WHERE token_hash = ? AND purpose = 'verify_email' AND expires_at > ?`).bind(tokenHash, new Date().toISOString()).first();
  if (!entry) return { status: 400, body: { error: "invalid_or_expired_token" } };
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ? AND status = 'active'")
      .bind(new Date().toISOString(), new Date().toISOString(), entry.user_id),
    env.DB.prepare("DELETE FROM auth_email_tokens WHERE token_hash = ?").bind(tokenHash),
    env.DB.prepare("DELETE FROM auth_email_tokens WHERE user_id = ? AND purpose = 'verify_email'").bind(entry.user_id),
  ]);
  return { status: 200, body: { status: "email_verified" } };
}

async function login(request, env) {
  const body = await requestData(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!validEmail(email) || password.length > 256) return { status: 400, body: { error: "invalid_credentials" } };
  const user = await env.DB.prepare("SELECT id, email, display_name, role, status, email_verified_at, password_hash FROM users WHERE email = ?")
    .bind(email).first();
  const verified = user?.email_verified_at && user.status === "active";
  const matches = await verifyPassword(password, user?.password_hash || "");
  if (!verified || !matches) return { status: 401, body: { error: "invalid_credentials_or_unverified_email" } };
  const token = randomToken();
  const expiresAt = isoAfter(SESSION_HOURS);
  await env.DB.prepare("INSERT INTO sessions(id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id(), user.id, await hashToken(token), expiresAt).run();
  return { status: 200, body: { token, expiresAt, user: publicUser(user) } };
}

async function sessionUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/);
  if (!match) return null;
  return env.DB.prepare(`SELECT u.id, u.email, u.display_name, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active' AND u.email_verified_at IS NOT NULL`)
    .bind(await hashToken(match[1]), new Date().toISOString()).first();
}

async function me(request, env) {
  const user = await sessionUser(request, env);
  return user ? { status: 200, body: { user: publicUser(user) } } : { status: 401, body: { error: "unauthorized" } };
}

async function logout(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/);
  if (match) await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), await hashToken(match[1])).run();
  return { status: 200, body: { status: "signed_out" } };
}

export async function handleAuth(request, env, pathname) {
  if (!env.DB) return { status: 503, body: { error: "database_unavailable" } };
  try {
    if (pathname === "/api/auth/register" && request.method === "POST") {
      if (await limited(request, env, "register", 5, 3600)) return { status: 429, body: { error: "rate_limited" } };
      return await register(request, env);
    }
    if (pathname === "/api/auth/verify-email" && request.method === "POST") {
      if (await limited(request, env, "verify", 10, 3600)) return { status: 429, body: { error: "rate_limited" } };
      return await verifyEmail(request, env);
    }
    if (pathname === "/api/auth/login" && request.method === "POST") {
      if (await limited(request, env, "login", 10, 900)) return { status: 429, body: { error: "rate_limited" } };
      return await login(request, env);
    }
    if (pathname === "/api/auth/me" && request.method === "GET") return await me(request, env);
    if (pathname === "/api/auth/logout" && request.method === "POST") return await logout(request, env);
    return null;
  } catch {
    return { status: 503, body: { error: "service_unavailable" } };
  }
}

export function isAuthPath(pathname) {
  return /^\/api\/auth\/(register|verify-email|login|me|logout)$/.test(pathname);
}

export function authMethodAllowed(pathname, method) {
  return (pathname.endsWith("/me") && method === "GET") || (!pathname.endsWith("/me") && method === "POST");
}
