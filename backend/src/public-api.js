const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 120;

function safeLimit(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
}

function searchTerm(value) {
  const term = String(value ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!term) return null;
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

function publicBusinessFields() {
  return `b.id, b.name, b.slug, b.service_type AS serviceType, b.location,
    b.website, b.social_handle AS socialHandle,
    b.whatsapp_number AS whatsappNumber`;
}

export async function listBusinesses(request, env) {
  const url = new URL(request.url);
  const term = searchTerm(url.searchParams.get("q"));
  const limit = safeLimit(url.searchParams.get("limit"));
  const rows = await env.DB.prepare(`
    SELECT ${publicBusinessFields()},
      COUNT(r.id) AS reviewCount,
      ROUND(AVG(r.rating), 1) AS averageRating
    FROM businesses b
    LEFT JOIN reviews r ON r.business_id = b.id
      AND r.status IN ('published', 'resolved')
    WHERE b.status = 'approved'
      AND (? IS NULL OR b.name LIKE ? ESCAPE '\\'
        OR b.website LIKE ? ESCAPE '\\'
        OR b.social_handle LIKE ? ESCAPE '\\'
        OR b.whatsapp_number LIKE ? ESCAPE '\\')
    GROUP BY b.id
    ORDER BY b.name COLLATE NOCASE
    LIMIT ?
  `).bind(term, term, term, term, term, limit).all();

  return { businesses: rows.results ?? [] };
}

export async function getBusiness(request, env, slug) {
  const business = await env.DB.prepare(`
    SELECT ${publicBusinessFields()},
      COUNT(r.id) AS reviewCount,
      ROUND(AVG(r.rating), 1) AS averageRating
    FROM businesses b
    LEFT JOIN reviews r ON r.business_id = b.id
      AND r.status IN ('published', 'resolved')
    WHERE b.slug = ? AND b.status = 'approved'
    GROUP BY b.id
    LIMIT 1
  `).bind(slug).first();

  if (!business) return null;
  const url = new URL(request.url);
  const limit = safeLimit(url.searchParams.get("limit"));
  const reviews = await env.DB.prepare(`
    SELECT r.id,
      COALESCE(b.name, r.provider_name) AS businessName,
      r.service_bought AS serviceBought,
      r.rating,
      CASE WHEN r.is_anonymous = 1 THEN 'Anonymous reviewer'
        ELSE COALESCE(NULLIF(r.display_name, ''), 'Community member')
      END AS displayName,
      r.location,
      r.experience,
      CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END AS isResolved,
      r.created_at AS createdAt
    FROM reviews r
    LEFT JOIN businesses b ON b.id = r.business_id
      AND b.status = 'approved'
    WHERE r.status IN ('published', 'resolved')
      AND r.business_id = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).bind(business.id, limit).all();

  return { business, reviews: reviews.results ?? [] };
}

export async function listPublicReviews(request, env) {
  const url = new URL(request.url);
  const limit = safeLimit(url.searchParams.get("limit"));
  const rows = await env.DB.prepare(`
    SELECT r.id,
      COALESCE(b.name, r.provider_name) AS businessName,
      r.service_bought AS serviceBought,
      r.rating,
      CASE WHEN r.is_anonymous = 1 THEN 'Anonymous reviewer'
        ELSE COALESCE(NULLIF(r.display_name, ''), 'Community member')
      END AS displayName,
      r.location,
      r.experience,
      CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END AS isResolved,
      r.created_at AS createdAt
    FROM reviews r
    LEFT JOIN businesses b ON b.id = r.business_id
      AND b.status = 'approved'
    WHERE r.status IN ('published', 'resolved')
    ORDER BY r.created_at DESC
    LIMIT ?
  `).bind(limit).all();

  return { reviews: rows.results ?? [] };
}
