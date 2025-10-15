CREATE TABLE users (
  user_id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  registration_record TEXT NOT NULL,
  encrypted_master_key BYTEA NOT NULL, 
  master_key_nonce BYTEA NOT NULL, 
  encrypted_recovery_key BYTEA NOT NULL, 
  recovery_key_nonce BYTEA NOT NULL,
  password_encrypted_master_key BYTEA NOT NULL,
  password_master_key_nonce BYTEA NOT NULL,
  salt BYTEA NOT NULL, 
  signing_public_key BYTEA NOT NULL,
  manifest_id BYTEA NOT NULL
);

CREATE TABLE opaque_sessions (
  username TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
