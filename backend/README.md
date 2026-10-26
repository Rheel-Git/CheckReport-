# CheckReport API foundation

The preview API serves approved business profiles and published reviews from D1. Verified customer accounts can submit reviews, and verified business accounts can submit profiles for admin approval. This is an API foundation; it does not yet connect the static GitHub Pages forms to the Worker.

## Public endpoints

- GET /api/health — Worker health.
- GET /api/ready — confirms a D1 connection.
- GET /api/businesses?q=...&limit=20 — searches approved businesses by name, website, social handle, or WhatsApp number.
- GET /api/businesses/:slug — returns one approved profile and its published/resolved reviews.
- GET /api/reviews?q=...&limit=20 — returns the public feed and searches provider name, website, or social handle, including older reviews not yet linked to a profile.
- GET /api/reviews/:id — returns a published review with its published comments.
- POST /api/auth/register — begins registration for a customer or business account and sends a verification email.
- POST /api/auth/verify-email — verifies an email address using its one-time token.
- POST /api/auth/login — signs in a verified active account and returns a short-lived bearer token.
- GET /api/auth/me — returns the signed-in account's public identity.
- POST /api/auth/logout — revokes the current bearer token.
- POST /api/reviews — creates a pending review for an authenticated customer.
- POST /api/businesses — creates a pending profile for an authenticated business account.

Write routes require `Authorization: Bearer <session-token>` and JSON content. Review requests accept `providerName`, `serviceBought`, optional `providerWebsite`, `providerSocial`, `providerPhone`, and `providerEmail`, `triedToResolve`, `experience` (20–5,000 characters), `rating` (1–5), `isAnonymous`, `displayName` when not anonymous, `location`, optional `complainantPhone`, and optional `businessId`. The review is stored as `pending`; contact details are stored separately in `review_private_details` and never returned by the public API. `businessId`, when supplied, must refer to an approved profile.

Business requests accept `name`, `serviceType`, `location`, optional `website`, `socialHandle`, `whatsappNumber`, `contactPhone`, and `contactEmail`. Contact email defaults to the verified account email. The profile remains `pending` and is not publicly searchable until an admin approves it. Logo upload is deferred until the R2 upload stage.

List endpoints cap page sizes at 50. Review responses contain the complainant display name (or anonymous label), location, rating, service and experience. SQL uses bound parameters and does not query the private contact table.

## Current deployment model

- The public site remains on GitHub Pages.
- The preview API is deployed at https://checkreport-api-preview.ubamuoma.workers.dev.
- The checkreport-preview D1 database has the core migration applied and is currently empty.
- Registration requires the Worker secrets RESEND_API_KEY, MAIL_FROM, and EMAIL_VERIFY_URL; until configured, registration returns an unavailable response and creates no account.
- Passwords use PBKDF2-HMAC-SHA256 with a per-account random salt; sessions store only a SHA-256 token digest, expire after 12 hours, and can be revoked.
- Email verification links expire after 24 hours. Public registration cannot grant administrator access. Login and registration requests have IP-based rate limits.
- The password hash uses 600,000 PBKDF2 iterations. Cloudflare Workers Free has a 10 ms CPU budget per request; confirm the plan's CPU budget and benchmark this hash in the deployed Worker before enabling sign-up. Do not lower the iteration count just to fit a plan limit.
- R2 will hold uploaded business and advert images when the upload stage is built.
- Resend will send account and review notifications after email flows are implemented.
- Secrets belong in Cloudflare Worker secrets or local .dev.vars; never commit API keys or passwords.

The allowlist includes the current GitHub Pages origin and local development. GitHub Pages uses a shared github.io origin, so production CORS should be narrowed to the custom domain when connected. CORS is not authentication.

## Local checks

Run Worker unit checks with Node.js: npm test.

The tests cover password hashing and policy, opaque sessions, auth route behavior, health/readiness, CORS, public business/review routes, approval filtering, private-field exclusion, and pagination limits. The core D1 migration and generated read statements were also executed against SQLite locally.

## Not connected yet

No production database, moderation endpoints, object storage, or email credentials have been configured. Authentication is not ready for real registrations until the Resend secrets are set and the preview flow is validated end to end. Review and profile writes are implemented, but the frontend forms are not connected yet. Admin review approval/deletion and business approval/hide/delete actions are not implemented. All writes use server-side authorization and rate limits.
