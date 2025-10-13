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