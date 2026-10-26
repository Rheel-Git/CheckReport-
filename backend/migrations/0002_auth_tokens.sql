CREATE TABLE auth_email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX auth_email_tokens_user_purpose_idx ON auth_email_tokens(user_id, purpose, expires_at);

-- Store only a one-way hash of the connecting IP for short-window abuse controls.
CREATE TABLE auth_rate_limits (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key_hash)
);
