import { getSessionUser } from "./auth.js";

const MAX_DASHBOARD_ROWS = 100;

function result(status, body) { return { status, body }; }

async function customerDashboard(env, user) {
  if (user.role !== "customer") return result(403, { error: "customer_account_required" });
  const reviews = await env.DB.prepare(`
    SELECT r.id, COALESCE(b.name, r.provider_name) AS businessName,
      r.service_bought AS serviceBought, r.rating,
      CASE WHEN r.is_anonymous = 1 THEN 'Anonymous'
        ELSE COALESCE(NULLIF(r.display_name, ''), 'Community member') END AS displayName,
      r.location, r.experience, r.status, r.created_at AS createdAt,
      (SELECT COUNT(*) FROM review_comments c
        WHERE c.review_id = r.id AND c.is_business_owner = 1 AND c.status = 'published') AS replyCount,
      (SELECT c.body FROM review_comments c
        WHERE c.review_id = r.id AND c.is_business_owner = 1 AND c.status = 'published'
        ORDER BY c.created_at DESC LIMIT 1) AS latestBusinessReply
    FROM reviews r
    LEFT JOIN businesses b ON b.id = r.business_id
    LEFT JOIN review_private_details p ON p.review_id = r.id
    WHERE r.user_id = ?
    ORDER BY r.created_at DESC
    LIMIT ${MAX_DASHBOARD_ROWS}
  `).bind(user.id).all();
  return result(200, {
    user: { email: user.email, displayName: user.display_name || null, role: user.role },
    reviews: reviews.results ?? [],
  });
}

async function businessDashboard(env, user) {
  if (user.role !== "business") return result(403, { error: "business_account_required" });
  const businesses = await env.DB.prepare(`
    SELECT id, name, slug, service_type AS serviceType, location, website,
      social_handle AS socialHandle, whatsapp_number AS whatsappNumber,
      contact_phone AS contactPhone, contact_email AS contactEmail,
      status, created_at AS createdAt
    FROM businesses
    WHERE owner_user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(user.id).all();
  const reviews = await env.DB.prepare(`
    SELECT r.id, b.id AS businessId, b.name AS businessName,
      r.service_bought AS serviceBought, r.rating,
      CASE WHEN r.is_anonymous = 1 THEN 'Anonymous'
        ELSE COALESCE(NULLIF(r.display_name, ''), 'Community member') END AS displayName,
      r.location, r.experience, r.status, r.created_at AS createdAt,
      (SELECT COUNT(*) FROM review_comments c
        WHERE c.review_id = r.id AND c.is_business_owner = 1 AND c.status = 'published') AS replyCount,
      (SELECT c.body FROM review_comments c
        WHERE c.review_id = r.id AND c.is_business_owner = 1 AND c.status = 'published'
        ORDER BY c.created_at DESC LIMIT 1) AS latestBusinessReply
    FROM reviews r
    JOIN businesses b ON b.id = r.business_id
    WHERE b.owner_user_id = ? AND r.status IN ('published', 'resolved')
    ORDER BY r.created_at DESC
    LIMIT ${MAX_DASHBOARD_ROWS}
  `).bind(user.id).all();
  return result(200, {
    user: { email: user.email, displayName: user.display_name || null, role: user.role },
    businesses: businesses.results ?? [],
    reviews: reviews.results ?? [],
  });
}

export function isAccountPath(pathname) {
  return pathname === "/api/account/dashboard" || pathname === "/api/businesses/mine";
}

export async function handleAccount(request, env, pathname) {
  if (!env.DB) return result(503, { error: "database_unavailable" });
  const user = await getSessionUser(request, env);
  if (!user) return result(401, { error: "unauthorized" });
  try {
    if (pathname === "/api/account/dashboard") return await customerDashboard(env, user);
    if (pathname === "/api/businesses/mine") return await businessDashboard(env, user);
    return result(404, { error: "not_found" });
  } catch {
    return result(503, { error: "dashboard_unavailable" });
  }
}
