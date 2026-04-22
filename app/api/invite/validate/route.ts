/**
 * POST /api/invite/validate
 * Validates an invite code. Does NOT increment usage — that happens on tenant creation.
 * Body: { code: string, email: string }
 * Returns: { valid, plan?, expiresAt?, error? }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { code?: string; email?: string };
    const code = body.code?.trim().toUpperCase();
    const email = body.email?.trim().toLowerCase();

    if (!code) {
      return NextResponse.json({ valid: false, error: "Code is required" });
    }
    if (!email) {
      return NextResponse.json({ valid: false, error: "Email is required" });
    }

    const sb = serviceClient();

    const { data: invite, error } = await sb
      .from("invite_codes")
      .select("*")
      .eq("code", code)
      .single();

    if (error || !invite) {
      return NextResponse.json({ valid: false, error: "Invalid code" });
    }

    if (!invite.active) {
      return NextResponse.json({ valid: false, error: "This code has been deactivated" });
    }

    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ valid: false, error: "Code expired" });
    }

    if (invite.used_count >= invite.max_uses) {
      return NextResponse.json({ valid: false, error: "Code depleted" });
    }

    if (invite.email && invite.email !== email) {
      return NextResponse.json({ valid: false, error: "This code is assigned to a different email" });
    }

    return NextResponse.json({
      valid: true,
      plan: invite.plan,
      expiresAt: invite.expires_at,
    });
  } catch {
    return NextResponse.json({ valid: false, error: "Server error" }, { status: 500 });
  }
}
