# CheckReport API foundation

This preview stage adds a read-only public API to the Cloudflare Worker scaffold. It serves approved business profiles and published reviews from D1. It does not accept account, review, comment, or business writes yet.

## Public endpoints

- GET /api/health — Worker health.
- GET /api/ready — confirms a D1 connection.
- GET /api/businesses?q=...&limit=20 — searches approved businesses by name, website, social handle, or WhatsApp number.
- GET /api/businesses/:slug — returns one approved profile and its published/resolved reviews.
- GET /api/reviews?limit=20 — returns the public review feed.

List endpoints cap page sizes at 50. Review responses contain the complainant display name (or anonymous label), location, rating, service and experience. SQL uses bound parameters and does not query the private contact table.

## Current deployment model

- The public site remains on GitHub Pages.
- The API will run as a separate Cloudflare Worker.
- D1 will hold relational records; R2 will hold uploaded business and advert images.
- Resend will send account and review notifications after email flows are implemented.
- Secrets belong in Cloudflare Worker secrets or local .dev.vars; never commit API keys or passwords.

The allowlist includes the current GitHub Pages origin and local development. GitHub Pages uses a shared github.io origin, so production CORS should be narrowed to the custom domain when connected. CORS is not authentication.

## Local checks

Run Worker unit checks with Node.js: npm test.

The tests cover health/readiness, CORS, public business/review routes, approval filtering, private-field exclusion, and pagination limits. The D1 migration and generated read statements were also executed against SQLite locally.

## Not connected yet

No production database, account authentication, email verification, review submission, moderation endpoints, object storage, or email credentials have been configured. Those are later stages and must be added with server-side authorization before real customer data is accepted.
