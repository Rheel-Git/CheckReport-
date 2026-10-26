import { getSessionUser, rateLimited } from "./auth.js";

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 24 * 1024;

function fail(status, error) {
  return { status, body: { error } };
}

async function readBody(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    return { error: "json_required" };
  }
  const declaredSize = Number(request.headers.get("Content-Length") || 0);
  if (declaredSize > MAX_BODY_BYTES) return { error: "request_too_large" };
  try {
    const reader = request.body?.getReader();
    if (!reader) return { error: "invalid_json_body" };
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return { error: "request_too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "invalid_json_body" };
    return { value };
  } catch {
    return { error: "invalid_json_body" };
  }
}

function text(value, max, { required = false, min = 1 } = {}) {
  if (value === undefined || value === null || value === "") return required ? { error: "required" } : { value: null };
  if (typeof value !== "string") return { error: "invalid" };
  const normalized = value.trim();
  if (!normalized && required) return { error: "required" };
  if (!normalized) return { value: null };
  if (normalized.length < min || normalized.length > max) return { error: "invalid_length" };
  return { value: normalized };
}

function email(value, required = false) {
  const parsed = text(value, 254, { required });
  if (parsed.error || !parsed.value) return parsed;
  const normalized = parsed.value.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? { value: normalized } : { error: "invalid_email" };
}

function phone(value) {
  const parsed = text(value, 32);
  if (parsed.error || !parsed.value) return parsed;
  return /^[+0-9() .-]{7,32}$/.test(parsed.value) ? parsed : { error: "invalid_phone" };
}

function webUrl(value) {
  const parsed = text(value, 2048);
  if (parsed.error || !parsed.value) return parsed;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(parsed.value) ? parsed.value : `https://${parsed.value}`;
  try {
    const url = new URL(candidate);
    if (!(["https:", "http:"].includes(url.protocol)) || !url.hostname || url.username || url.password) {
      return { error: "invalid_url" };
    }
    return { value: url.toString() };
  } catch {
    return { error: "invalid_url" };
  }
}

function slugBase(name) {
  return name.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || "business";
}

function validateReview(body, user) {
  const providerName = text(body.providerName, 160, { required: true });
  const serviceBought = text(body.serviceBought, 160, { required: true });
  const providerWebsite = webUrl(body.providerWebsite);
  const providerSocial = text(body.providerSocial, 200);
  const providerPhone = phone(body.providerPhone);
  const providerEmail = email(body.providerEmail);
  const experience = text(body.experience, 5000, { required: true, min: 20 });
  const location = text(body.location, 120, { required: true });
  const publicName = body.isAnonymous === true ? { value: null } : text(body.displayName || user.display_name, 120, { required: true });
  const complainantPhone = phone(body.complainantPhone);

  for (const field of [providerName, serviceBought, providerWebsite, providerSocial, providerPhone,
    providerEmail, experience, location, publicName, complainantPhone]) {
    if (field.error) return { error: "invalid_review_fields" };
  }
  if (typeof body.triedToResolve !== "boolean" || typeof body.isAnonymous !== "boolean" ||
      !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    return { error: "invalid_review_fields" };
  }
  const businessId = body.businessId === undefined || body.businessId === null || body.businessId === ""
    ? null
    : typeof body.businessId === "string" && body.businessId.length <= 80 ? body.businessId : undefined;
  if (businessId === undefined) return { error: "invalid_review_fields" };

  return { value: {
    providerName: providerName.value,
    serviceBought: serviceBought.value,
    providerWebsite: providerWebsite.value,
    providerSocial: providerSocial.value,
    providerPhone: providerPhone.value,
    providerEmail: providerEmail.value,
    experience: experience.value,
    rating: body.rating,
    triedToResolve: body.triedToResolve ? 1 : 0,
    location: location.value,
    displayName: body.isAnonymous ? null : publicName.value,
    isAnonymous: body.isAnonymous ? 1 : 0,
    complainantEmail: user.email,
    complainantPhone: complainantPhone.value,
    businessId,
  } };
}

async function createReview(request, env, user) {
  if (user.role !== "customer") return fail(403, "customer_account_required");
  if (await rateLimited(request, env, "review-submit", 5, 3600, user.id)) return fail(429, "rate_limited");
  const parsed = await readBody(request);
  if (parsed.error) return fail(parsed.error === "request_too_large" ? 413 : 400, parsed.error);
  const checked = validateReview(parsed.value, user);
  if (checked.error) return fail(400, checked.error);
  const review = checked.value;

  if (review.businessId) {
    const business = await env.DB.prepare("SELECT id FROM businesses WHERE id = ? AND status = 'approved'")
      .bind(review.businessId).first();
    if (!business) return fail(400, "business_not_approved_or_not_found");
  }

  const reviewId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO reviews (
        id, user_id, business_id, provider_name, service_bought, provider_website,
        provider_social, tried_to_resolve, experience, rating, display_name,
        is_anonymous, location, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
        .bind(reviewId, user.id, review.businessId, review.providerName, review.serviceBought,
          review.providerWebsite, review.providerSocial, review.triedToResolve, review.experience,
          review.rating, review.displayName, review.isAnonymous, review.location),
      env.DB.prepare(`INSERT INTO review_private_details (
        review_id, complainant_email, complainant_phone, provider_email, provider_phone
      ) VALUES (?, ?, ?, ?, ?)`)
        .bind(reviewId, review.complainantEmail, review.complainantPhone, review.providerEmail, review.providerPhone),
    ]);
  } catch {
    return fail(503, "review_submission_unavailable");
  }
  return { status: 201, body: { review: { id: reviewId, status: "pending" } } };
}

async function createBusiness(request, env, user) {
  if (user.role !== "business") return fail(403, "business_account_required");
  if (await rateLimited(request, env, "business-submit", 3, 86400, user.id)) return fail(429, "rate_limited");
  const parsed = await readBody(request);
  if (parsed.error) return fail(parsed.error === "request_too_large" ? 413 : 400, parsed.error);
  const body = parsed.value;
  const name = text(body.name, 160, { required: true });
  const serviceType = text(body.serviceType, 120, { required: true });
  const location = text(body.location, 160, { required: true });
  const website = webUrl(body.website);
  const socialHandle = text(body.socialHandle, 200);
  const whatsappNumber = phone(body.whatsappNumber);
  const contactPhone = phone(body.contactPhone);
  const contactEmail = email(body.contactEmail);
  for (const field of [name, serviceType, location, website, socialHandle, whatsappNumber, contactPhone, contactEmail]) {
    if (field.error) return fail(400, "invalid_business_fields");
  }

  const businessId = crypto.randomUUID();
  const slug = `${slugBase(name.value)}-${businessId.slice(0, 8)}`;
  try {
    await env.DB.prepare(`INSERT INTO businesses (
      id, owner_user_id, name, slug, service_type, location, website,
      social_handle, whatsapp_number, contact_phone, contact_email, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .bind(businessId, user.id, name.value, slug, serviceType.value, location.value,
        website.value, socialHandle.value, whatsappNumber.value, contactPhone.value,
        contactEmail.value || user.email).run();
  } catch {
    return fail(503, "business_submission_unavailable");
  }
  return { status: 201, body: { business: { id: businessId, slug, name: name.value, status: "pending" } } };
}

export async function handleSubmission(request, env, pathname) {
  if (!env.DB) return fail(503, "database_unavailable");
  const user = await getSessionUser(request, env);
  if (!user) return fail(401, "unauthorized");
  try {
    if (pathname === "/api/reviews") return await createReview(request, env, user);
    if (pathname === "/api/businesses") return await createBusiness(request, env, user);
    return null;
  } catch {
    return fail(503, "service_unavailable");
  }
}

export function isSubmissionPath(pathname) {
  return pathname === "/api/reviews" || pathname === "/api/businesses";
}
