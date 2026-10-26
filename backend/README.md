# CheckReport API foundation

This is Stage 1 of the production backend: a Cloudflare Worker entry point, a D1 schema migration, and a local health/readiness test suite. It does not accept or expose reviews, accounts, or personal information yet.

## Current deployment model

- The public site remains on GitHub Pages.
- The API will run as a separate Cloudflare Worker.
- D1 will hold relational records; R2 will hold uploaded business and advert images.
- Resend will send account and review notifications after the email flow is implemented.
- Secrets belong in Cloudflare Worker secrets or local `.dev.vars`; never commit API keys or passwords.

The allowlist includes the current GitHub Pages origin and local development. GitHub Pages uses a shared `github.io` origin, so production CORS should be narrowed to a custom domain once that domain is connected. CORS is not authentication.

## Local check

Run the Worker unit checks with Node.js:

```sh
npm test
```

Run the Cloudflare preview after installing Wrangler and creating a local D1 binding:

```sh
npm install --save-dev wrangler
npx wrangler d1 create checkreport-preview
```

Add the returned database ID to a preview-only Wrangler config, apply the migration, then run `npx wrangler dev`. Do not point local development at production data.

## Schema coverage

The initial migration separates private review contact details from public review content and provides records for users/sessions, business approval and visibility, comments, moderated review-to-business links, advertisements, shared site settings, and moderation actions.

Before adding account or data endpoints, choose and implement the authentication/session design, email verification and reset flow, admin authorization, abuse controls, and retention policy. No authentication method or production database has been configured yet.
