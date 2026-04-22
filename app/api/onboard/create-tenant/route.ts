/**
 * POST /api/onboard/create-tenant
 *
 * Creates auth user, tenant, factory, and tenant_member using service role.
 * Looks up invite code to determine plan. Increments invite usage on success.
 *
 * Body: {
 *   tenantName, tenantSlug,
 *   email, password,
 *   inviteCode,          — required (plan derived from invite_codes table)
 * }
 *
 * No auth header required — this endpoint creates the user.
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
    const body = await req.json() as {
      tenantName: string;
      tenantSlug: string;
      email: string;
      password: string;
      inviteCode: string;
    };

    if (!body.tenantName?.trim() || !body.tenantSlug?.trim()) {
      return NextResponse.json({ error: "Tenant name and slug are required" }, { status: 400 });
    }
    if (!body.email?.trim() || !body.password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (body.password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (!body.inviteCode?.trim()) {
      return NextResponse.json({ error: "Invite code is required" }, { status: 400 });
    }

    const sb = serviceClient();
    const email = body.email.trim().toLowerCase();
    const code = body.inviteCode.trim().toUpperCase();

    // 1. Validate invite code and get plan
    const { data: invite, error: invErr } = await sb
      .from("invite_codes")
      .select("*")
      .eq("code", code)
      .single();

    if (invErr || !invite) {
      return NextResponse.json({ error: "Invalid invite code" }, { status: 400 });
    }
    if (!invite.active) {
      return NextResponse.json({ error: "This invite code has been deactivated" }, { status: 400 });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: "Invite code expired" }, { status: 400 });
    }
    if (invite.used_count >= invite.max_uses) {
      return NextResponse.json({ error: "Invite code depleted" }, { status: 400 });
    }
    if (invite.email && invite.email !== email) {
      return NextResponse.json({ error: "This code is assigned to a different email" }, { status: 400 });
    }

    const plan = invite.plan as string;

    // 2. Check slug availability
    const { data: slugCheck } = await sb
      .from("tenants")
      .select("id")
      .eq("slug", body.tenantSlug.trim())
      .maybeSingle();
    if (slugCheck) {
      return NextResponse.json({ error: "Tenant slug already taken" }, { status: 409 });
    }

    // 3. Create auth user (skip email confirmation)
    //    If user already exists (interrupted onboard), look them up and check if they have a tenant.
    let userId: string;

    const { data: authData, error: authErr } = await sb.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
    });

    if (authErr) {
      const msg = authErr.message.toLowerCase();
      const alreadyExists = msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (!alreadyExists) {
        return NextResponse.json({ error: `Account creation failed: ${authErr.message}` }, { status: 500 });
      }

      // User exists in Auth — look up by email
      const { data: existingUsers } = await sb.auth.admin.listUsers();
      const existingUser = existingUsers?.users?.find((u) => u.email === email);
      if (!existingUser) {
        return NextResponse.json({ error: "Account exists but could not be found. Try signing in.", redirect: "/login" }, { status: 409 });
      }

      // Check if they already have a tenant
      const { data: existingMember } = await sb
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", existingUser.id)
        .maybeSingle();

      if (existingMember) {
        // Already fully set up — redirect to login
        return NextResponse.json({ error: "Account already set up. Please sign in.", redirect: "/login" }, { status: 409 });
      }

      // User exists but no tenant — resume onboard, update password to match form
      userId = existingUser.id;
      await sb.auth.admin.updateUserById(userId, { password: body.password });
    } else {
      userId = authData.user.id;
    }

    // 4. Create tenant
    const { data: tenant, error: tErr } = await sb
      .from("tenants")
      .insert({
        name: body.tenantName.trim(),
        slug: body.tenantSlug.trim(),
        plan,
        invite_code: code,
        invite_plan: plan,
        invite_expires_at: invite.expires_at,
      })
      .select("id")
      .single();

    if (tErr) {
      await sb.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: `Tenant creation failed: ${tErr.message}` }, { status: 500 });
    }

    // 5. Link user as owner (factory created later by user in Factory Settings)
    const { error: mErr } = await sb
      .from("tenant_members")
      .insert({
        tenant_id: tenant!.id,
        user_id: userId,
        role: "owner",
      });

    if (mErr) {
      await sb.from("tenants").delete().eq("id", tenant!.id);
      await sb.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: `Member creation failed: ${mErr.message}` }, { status: 500 });
    }

    // 7. Increment invite code usage
    await sb
      .from("invite_codes")
      .update({ used_count: invite.used_count + 1 })
      .eq("id", invite.id);

    // Notify owner about new tenant
    try {
      const { createNotification } = await import("@/lib/notifications");
      const { data: owner } = await sb.from("tenants").select("id").eq("plan", "owner").limit(1).single();
      if (owner) await createNotification({ tenantId: owner.id, eventType: "new_tenant_registered", severity: "info", title: `New tenant: ${body.tenantName}`, body: `${email} · plan: ${plan}`, metadata: { newTenantId: tenant!.id, email, plan } });
    } catch { /* non-blocking */ }

    return NextResponse.json({ tenantId: tenant!.id, plan });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
