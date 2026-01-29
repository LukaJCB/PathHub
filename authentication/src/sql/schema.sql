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

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_username_trgm ON users USING gin (lower(username) gin_trgm_ops);

CREATE TABLE opaque_sessions (
  username TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  sender_id UUID NOT NULL,
  payload BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE message_recipients (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL,
  received_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, recipient_id)
);

CREATE INDEX idx_message_recipients_recipient_id ON message_recipients (recipient_id);
CREATE INDEX idx_messages_expires_at ON messages (expires_at);

CREATE TABLE content_pointers (
  user_id UUID NOT NULL,
  object_id TEXT NOT NULL,
  storage_id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (object_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_content_pointers_object_id ON content_pointers (object_id);


CREATE TABLE follows (
  follower_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX idx_follows_follower_id ON follows (follower_id);
CREATE INDEX idx_follows_followee_id ON follows (followee_id);