import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(request) {
  const { id } = await request.json();
  if (!id) return Response.json({ error: "id manquant" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("albums")
    .update({ issue: "cover_reported" })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
