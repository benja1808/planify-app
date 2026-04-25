CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint TEXT NOT NULL UNIQUE,
    subscription JSONB NOT NULL,
    role TEXT NOT NULL DEFAULT 'visita',
    trabajador_id UUID REFERENCES trabajadores(id) ON DELETE SET NULL,
    trabajador_nombre TEXT,
    user_agent TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_role ON push_subscriptions(role);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_trabajador ON push_subscriptions(trabajador_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled ON push_subscriptions(enabled);

ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;
