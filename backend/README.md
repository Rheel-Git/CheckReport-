# CheckReport API foundation

The preview API serves approved business profiles and published reviews from D1, and now includes a first account-access stage: email verification, customer/business registration, sign-in, profile lookup, and sign-out. Review submissions and business profile edits are not enabled yet.

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

No production database, review submission, moderation endpoints, object storage, or email credentials have been configured. Authentication is not ready for real registrations until the Resend secrets are set and the preview flow is validated end to end. All future writes need server-side authorization.
