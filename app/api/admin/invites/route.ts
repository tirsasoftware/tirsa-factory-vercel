/**
 * GET  /api/admin/invites — list all invite codes
 * POST /api/admin/invites — generate new invite code
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function assertAdmin(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const sb = serviceClient();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  if ((user.app_metadata as Record<string, unknown>)?.role !== "admin") throw new Error("Forbidden");
  return user;
}

function generateCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code.slice(0, 4) + "-" + code.slice(4);
}

export async function GET(req: NextRequest) {
  try {
    await assertAdmin(req);
    const sb = serviceClient();
    const { data, error } = await sb
      .from("invite_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ codes: data });
  } catch (e: unknown) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await assertAdmin(req);
    const body = (await req.json()) as { plan?: string; email?: string; expiresInDays?: number; maxUses?: number };
    const plan = body.plan;
    const email = body.email?.trim().toLowerCase();
    if (!plan || !["starter", "pro", "enterprise"].includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const expiresInDays = body.expiresInDays ?? 90;
    const maxUses = body.maxUses ?? 1;
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();

    const code = generateCode();
    const sb = serviceClient();
    const { data, error } = await sb
      .from("invite_codes")
      .insert({
        code,
        email,
        plan,
        max_uses: maxUses,
        expires_at: expiresAt,
        created_by: user.id,
      })
      .select("id, code, plan, max_uses, expires_at")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ code: data });
  } catch (e: unknown) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }
}
