CREATE TABLE webhook_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL DEFAULT 'stripe',
  event_id      text,
  event_type    text,
  status        text NOT NULL DEFAULT 'received', -- received | processed | failed
  error         text,
  payload       jsonb
);

CREATE INDEX webhook_logs_created_at_idx ON webhook_logs (created_at DESC);
CREATE INDEX webhook_logs_event_id_idx ON webhook_logs (event_id);
CREATE INDEX webhook_logs_status_idx ON webhook_logs (status);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
-- Only service role can access (webhooks write via service role key)
