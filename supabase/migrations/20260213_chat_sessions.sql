-- Treasury AI Chat — session & message persistence
-- These tables are SEPARATE from the cotizaciones app's chat_sessions/chat_messages.
-- Run this migration in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.treasury_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL DEFAULT 'Nueva conversación',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.treasury_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.treasury_chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL DEFAULT '',
    tool_calls JSONB DEFAULT '[]'::jsonb,
    images JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_chat_messages_session ON public.treasury_chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_chat_sessions_updated ON public.treasury_chat_sessions(updated_at DESC);

-- RLS: allow service role full access (agent backend uses service role key)
ALTER TABLE public.treasury_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_chat_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Service role full access on treasury_chat_sessions" ON public.treasury_chat_sessions;
    DROP POLICY IF EXISTS "Service role full access on treasury_chat_messages" ON public.treasury_chat_messages;
END $$;

CREATE POLICY "Service role full access on treasury_chat_sessions"
    ON public.treasury_chat_sessions FOR ALL
    USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on treasury_chat_messages"
    ON public.treasury_chat_messages FOR ALL
    USING (true) WITH CHECK (true);
