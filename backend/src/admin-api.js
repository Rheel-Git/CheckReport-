import { getSessionUser, rateLimited } from "./auth.js";

function result(status, body) { return { status, body }; }

async function parseJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return null;
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 8192) return null;
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

async function requireAdmin(request, env) {
  const user = await getSessionUser(request, env);
  return user?.role === "admin" ? user : null;
}

async function listReviews(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const statuses = new Set(["pending", "published", "resolved", "hidden", "deleted"]);
  if (status !== "all" && !statuses.has(status)) return result(400, { error: "invalid_status" });
  const rows = await env.DB.prepare(`
    SELECT r.id, r.business_id AS businessId, r.provider_name AS providerName,
      r.service_bought AS serviceBought, r.provider_website AS providerWebsite,
      r.provider_social AS providerSocial, r.tried_to_resolve AS triedToResolve,
      r.experience, r.rating, r.display_name AS displayName, r.is_anonymous AS isAnonymous,
      r.location, r.status, r.created_at AS createdAt,
      p.complainant_email AS complainantEmail, p.complainant_phone AS complainantPhone,
      p.provider_email AS providerEmail, p.provider_phone AS providerPhone
    FROM reviews r LEFT JOIN review_private_details p ON p.review_id = r.id
    WHERE (? = 'all' OR r.status = ?)
    ORDER BY r.created_at ASC LIMIT 100
  `).bind(status, status).all();
  return result(200, { reviews: rows.results ?? [] });
}

async function listBusinesses(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "pending";
  const statuses = new Set(["pending", "approved", "hidden", "deleted"]);
  if (status !== "all" && !statuses.has(status)) return result(400, { error: "invalid_status" });
  const rows = await env.DB.prepare(`
    SELECT id, owner_user_id AS ownerUserId, name, slug, service_type AS serviceType,
      location, website, social_handle AS socialHandle, whatsapp_number AS whatsappNumber,
      contact_phone AS contactPhone, contact_email AS contactEmail,
      status, created_at AS createdAt
    FROM businesses WHERE (? = 'all' OR status = ?)
    ORDER BY created_at ASC LIMIT 100
  `).bind(status, status).all();
  return result(200, { businesses: rows.results ?? [] });
}

async function moderateReview(request, env, admin, reviewId) {
  const body = await parseJson(request);
  const actions = { publish: "published", hide: "hidden", delete: "deleted", restore: "pending" };
  if (!body || !Object.hasOwn(actions, body.action) || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500))) {
    return result(400, { error: "invalid_moderation_action" });
  }
  if (await rateLimited(request, env, "admin-review-moderate", 60, 3600, admin.id)) return result(429, { error: "rate_limited" });
  const next = actions[body.action];
  const deletedAt = next === "deleted" ? new Date().toISOString() : null;
  const at = new Date().toISOString();
  try {
    const updated = await env.DB.prepare(`UPDATE reviews SET status = ?, deleted_at = ?,
      published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END,
      updated_at = ? WHERE id = ? AND status != 'deleted'`)
      .bind(next, deletedAt, next, at, at, reviewId).run();
    if (updated.meta?.changes === 0) return result(404, { error: "review_not_found" });
    await env.DB.prepare(`INSERT INTO moderation_actions(id, actor_user_id, target_type, target_id, action, reason)
      VALUES (?, ?, 'review', ?, ?, ?)`)
      .bind(crypto.randomUUID(), admin.id, reviewId, body.action, body.reason?.trim() || null).run();
    return result(200, { review: { id: reviewId, status: next } });
  } catch { return result(503, { error: "moderation_unavailable" }); }
}

async function moderateBusiness(request, env, admin, businessId) {
  const body = await parseJson(request);
  const actions = { approve: "approved", hide: "hidden", show: "approved", delete: "deleted" };
  if (!body || !Object.hasOwn(actions, body.action) || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500))) {
    return result(400, { error: "invalid_moderation_action" });
  }
  if (await rateLimited(request, env, "admin-business-moderate", 60, 3600, admin.id)) return result(429, { error: "rate_limited" });
  const next = actions[body.action];
  const at = new Date().toISOString();
  try {
    const updated = await env.DB.prepare(`UPDATE businesses SET status = ?,
      approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
      approved_at = CASE WHEN ? = 'approved' THEN COALESCE(approved_at, ?) ELSE approved_at END,
      deleted_at = CASE WHEN ? = 'deleted' THEN ? ELSE NULL END,
      updated_at = ? WHERE id = ?`)
      .bind(next, next, admin.id, next, at, next, at, at, businessId).run();
    if (updated.meta?.changes === 0) return result(404, { error: "business_not_found" });
    await env.DB.prepare(`INSERT INTO moderation_actions(id, actor_user_id, target_type, target_id, action, reason)
      VALUES (?, ?, 'business', ?, ?, ?)`)
      .bind(crypto.randomUUID(), admin.id, businessId, body.action, body.reason?.trim() || null).run();
    return result(200, { business: { id: businessId, status: next } });
  } catch { return result(503, { error: "moderation_unavailable" }); }
}

export function isAdminPath(pathname) { return pathname === "/api/admin/reviews" || pathname === "/api/admin/businesses" || /^\/api\/admin\/(reviews|businesses)\/[a-z0-9_-]{1,80}$/i.test(pathname); }

export async function handleAdmin(request, env, pathname) {
  if (!env.DB) return result(503, { error: "database_unavailable" });
  const admin = await requireAdmin(request, env);
  if (!admin) return result(403, { error: "admin_account_required" });
  try {
    if (request.method === "GET" && pathname === "/api/admin/reviews") return await listReviews(request, env);
    if (request.method === "GET" && pathname === "/api/admin/businesses") return await listBusinesses(request, env);
    const match = pathname.match(/^\/api\/admin\/(reviews|businesses)\/([a-z0-9_-]{1,80})$/i);
    if (request.method === "POST" && match?.[1] === "reviews") return await moderateReview(request, env, admin, match[2]);
    if (request.method === "POST" && match?.[1] === "businesses") return await moderateBusiness(request, env, admin, match[2]);
    return result(405, { error: "method_not_allowed" });
  } catch { return result(503, { error: "service_unavailable" }); }
}
