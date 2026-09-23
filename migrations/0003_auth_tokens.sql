ALTER TABLE users ADD COLUMN access_token TEXT;
ALTER TABLE users ADD COLUMN refresh_token TEXT;
ALTER TABLE users ADD COLUMN token_expires_at TEXT;
ALTER TABLE users ADD COLUMN role_checked_at TEXT;
