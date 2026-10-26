PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  phone TEXT,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('customer', 'business', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  service_type TEXT NOT NULL,
  location TEXT NOT NULL,
  website TEXT,
  social_handle TEXT,
  whatsapp_number TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  logo_object_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden', 'deleted')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  business_id TEXT REFERENCES businesses(id),
  provider_name TEXT NOT NULL,
  service_bought TEXT NOT NULL,
  provider_website TEXT,
  provider_social TEXT,
  tried_to_resolve INTEGER NOT NULL CHECK (tried_to_resolve IN (0, 1)),
  experience TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  display_name TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'resolved', 'hidden', 'deleted')),
  deleted_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Keep complainant and provider contact information out of public review records and queries.
CREATE TABLE review_private_details (
  review_id TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
  complainant_email TEXT,
  complainant_phone TEXT,
  provider_email TEXT,
  provider_phone TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE review_comments (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id),
  author_name TEXT,
  is_business_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_business_owner IN (0, 1)),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Admin-reviewed links support registered businesses matching older or unmatched reviews.
CREATE TABLE review_business_links (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requested_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (review_id, business_id)
);

CREATE TABLE site_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE advertisements (
  id TEXT PRIMARY KEY,
  image_object_key TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'expired', 'deleted')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE moderation_actions (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX sessions_user_expires_idx ON sessions(user_id, expires_at);
CREATE INDEX businesses_status_created_idx ON businesses(status, created_at);
CREATE INDEX reviews_business_status_created_idx ON reviews(business_id, status, created_at);
CREATE INDEX reviews_status_created_idx ON reviews(status, created_at);
CREATE INDEX review_comments_review_status_created_idx ON review_comments(review_id, status, created_at);
CREATE INDEX review_business_links_status_created_idx ON review_business_links(status, created_at);
CREATE INDEX advertisements_status_dates_idx ON advertisements(status, starts_at, ends_at);
