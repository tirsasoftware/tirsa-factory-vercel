/**
 * GET  /api/settings/apikey?tenantId=... — returns { exists, preview? }
 * POST /api/settings/apikey              — body { tenantId } — generates new key, returns it ONCE
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function assertMember(sb: ReturnType<typeof serviceClient>, token: string, tenantId: string) {
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  const { data } = await sb.from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", user.id).single();
  if (!data) throw new Error("Forbidden");
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const sb = serviceClient();
  try {
    await assertMember(sb, token, tenantId);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const { data } = await sb.from("tenant_api_keys").select("preview, created_at").eq("tenant_id", tenantId).single();
  if (!data) return NextResponse.json({ exists: false });
  return NextResponse.json({ exists: true, preview: data.preview, created_at: data.created_at });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { tenantId: string };
  const { tenantId } = body;
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const sb = serviceClient();
  try {
    await assertMember(sb, token, tenantId);
  } catch (e: unknown) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const raw = "sk_live_" + randomBytes(24).toString("hex");
  const preview = "…" + raw.slice(-6);

  const { error } = await sb.from("tenant_api_keys").upsert(
    { tenant_id: tenantId, key: raw, preview, created_at: new Date().toISOString() },
    { onConflict: "tenant_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return raw key ONCE — never retrievable again from the API
  return NextResponse.json({ key: raw, preview });
}
