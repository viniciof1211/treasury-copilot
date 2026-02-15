import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Use the direct Postgres connection available in Edge Functions
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: "SUPABASE_DB_URL not available" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Import postgres client
  const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.5/mod.js");
  const sql = postgres(dbUrl, { max: 1 });

  const results: string[] = [];

  try {
    // Create treasury_chat_sessions
    await sql`
      CREATE TABLE IF NOT EXISTS public.treasury_chat_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL DEFAULT 'Nueva conversación',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    results.push("treasury_chat_sessions: created/exists");

    // Create treasury_chat_messages
    await sql`
      CREATE TABLE IF NOT EXISTS public.treasury_chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES public.treasury_chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL DEFAULT '',
        tool_calls JSONB DEFAULT '[]'::jsonb,
        images JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    results.push("treasury_chat_messages: created/exists");

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_treasury_chat_messages_session ON public.treasury_chat_messages(session_id, created_at)`;
    results.push("idx_treasury_chat_messages_session: created/exists");

    await sql`CREATE INDEX IF NOT EXISTS idx_treasury_chat_sessions_updated ON public.treasury_chat_sessions(updated_at DESC)`;
    results.push("idx_treasury_chat_sessions_updated: created/exists");

    // Enable RLS
    await sql`ALTER TABLE public.treasury_chat_sessions ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE public.treasury_chat_messages ENABLE ROW LEVEL SECURITY`;
    results.push("RLS enabled on both tables");

    // Drop and recreate policies
    await sql`DROP POLICY IF EXISTS "Service role full access on treasury_chat_sessions" ON public.treasury_chat_sessions`;
    await sql`DROP POLICY IF EXISTS "Service role full access on treasury_chat_messages" ON public.treasury_chat_messages`;

    await sql`CREATE POLICY "Service role full access on treasury_chat_sessions" ON public.treasury_chat_sessions FOR ALL USING (true) WITH CHECK (true)`;
    await sql`CREATE POLICY "Service role full access on treasury_chat_messages" ON public.treasury_chat_messages FOR ALL USING (true) WITH CHECK (true)`;
    results.push("RLS policies created");

    await sql.end();

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await sql.end();
    return new Response(JSON.stringify({ error: (e as Error).message, results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
