/**
 * POST /api/settings/integrations
 * Saves tenant API keys to tenant_integrations.secret_value (service_role only).
 * Keys are never returned to the browser — RLS blocks all authenticated/anon reads.
 *
 * GET /api/settings/integrations?tenantId=...
 * Returns which (serviceId:keyName) pairs are already configured — no values.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase service role env vars not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function assertMember(req: NextRequest, tenantId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const sb = getServiceClient();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  const { data: member } = await sb.from("tenant_members").select("id").eq("tenant_id", tenantId).eq("user_id", user.id).single();
  if (!member) throw new Error("Forbidden");
}

/* ─── GET — list configured key names ─────────────────────── */

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  try {
    await assertMember(req, tenantId);
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("tenant_integrations")
      .select("service_id, var_name")
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    const configured = (data ?? []).map(
      (r: { service_id: string; var_name: string }) => `${r.service_id}:${r.var_name}`,
    );
    return NextResponse.json({ configured });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/* ─── POST — save keys ─────────────────────────────────────── */

interface SaveBody {
  tenantId: string;
  serviceId: string;
  keys: Record<string, string>;
}

export async function POST(req: NextRequest) {
  let body: SaveBody;
  try {
    body = await req.json() as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tenantId, serviceId, keys } = body;
  if (!tenantId || !serviceId || !keys || typeof keys !== "object") {
    return NextResponse.json({ error: "tenantId, serviceId and keys are required" }, { status: 400 });
  }

  try {
    await assertMember(req, tenantId);
    const sb = getServiceClient();

    for (const [varName, rawValue] of Object.entries(keys)) {
      if (!rawValue?.trim()) continue;

      // Normalize GITHUB_OWNER: accept full URL or bare username/org name
      let value = rawValue.trim();
      if (varName === "GITHUB_OWNER") {
        // Strip https://github.com/ prefix if present
        value = value.replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "").trim();
      }

      const { error: upsertErr } = await sb
        .from("tenant_integrations")
        .upsert(
          {
            tenant_id:    tenantId,
            service_id:   serviceId,
            var_name:     varName,
            secret_value: value,
            updated_at:   new Date().toISOString(),
          },
          { onConflict: "tenant_id,service_id,var_name" },
        );

      if (upsertErr) throw new Error(`Save failed: ${upsertErr.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("[settings/integrations] POST error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
