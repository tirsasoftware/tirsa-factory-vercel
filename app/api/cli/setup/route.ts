/**
 * GET /api/cli/setup?token=<setup-token>
 *
 * Returns a pre-configured .env file for the tirsa-factory-cli.
 * The token is a tenant API key (TIRSA_API_KEY) or a one-time setup token.
 *
 * The .env includes all credentials needed to run trigger dev locally:
 *   - TRIGGER_PROJECT_ID, TRIGGER_SECRET_KEY (dev key)
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - Tenant metadata
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token parameter required" }, { status: 400 });
  }

  try {
    const sb = serviceClient();

    // Resolve tenant from token — try as API key first
    const { data: tokenRow } = await sb
      .from("tenant_integrations")
      .select("tenant_id")
      .eq("service_id", "cli")
      .eq("var_name", "TIRSA_API_KEY")
      .eq("secret_value", token)
      .maybeSingle();

    let tenantId = (tokenRow as { tenant_id?: string } | null)?.tenant_id;

    // Fallback: try as setup token
    if (!tenantId) {
      const { data: setupRow } = await sb
        .from("tenant_integrations")
        .select("tenant_id")
        .eq("service_id", "cli")
        .eq("var_name", "SETUP_TOKEN")
        .eq("secret_value", token)
        .maybeSingle();
      tenantId = (setupRow as { tenant_id?: string } | null)?.tenant_id;
    }

    if (!tenantId) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Load all tenant credentials
    const { data: allIntegrations } = await sb
      .from("tenant_integrations")
      .select("service_id, var_name, secret_value")
      .eq("tenant_id", tenantId);

    const vars: Record<string, string> = {};
    for (const row of allIntegrations ?? []) {
      const name = row.var_name as string;
      const value = row.secret_value as string | null;
      if (!value) continue;

      // Only include relevant vars (skip storage JSON configs, etc.)
      if (name === "TRIGGER_PROJECT_ID") vars.TRIGGER_PROJECT_ID = value;
      if (name === "TRIGGER_DEV_SECRET_KEY") vars.TRIGGER_SECRET_KEY = value; // dev key as default
      if (name === "TRIGGER_PROD_SECRET_KEY") vars.TRIGGER_PROD_SECRET_KEY = value;
      if (name === "TRIGGER_SECRET_KEY") vars.TRIGGER_SECRET_KEY ??= value;
      if (name === "GITHUB_TOKEN") vars.GITHUB_TOKEN = value;
      if (name === "GITHUB_OWNER") vars.GITHUB_OWNER = value;
      if (name === "ANTHROPIC_API_KEY") vars.ANTHROPIC_API_KEY = value;
      if (name === "OPENAI_API_KEY") vars.OPENAI_API_KEY = value;
      if (name === "GEMINI_API_KEY") vars.GEMINI_API_KEY = value;
    }

    // Add Supabase credentials (from command-center env or storage backend)
    const { data: storageRow } = await sb
      .from("tenant_integrations")
      .select("secret_value")
      .eq("tenant_id", tenantId)
      .eq("service_id", "storage")
      .limit(1)
      .single();

    if (storageRow?.secret_value) {
      try {
        const cfg = JSON.parse((storageRow as { secret_value: string }).secret_value);
        if (cfg.type === "supabase" && cfg.url) vars.SUPABASE_URL = cfg.url;
        if (cfg.type === "supabase" && cfg.key) vars.SUPABASE_SERVICE_ROLE_KEY = cfg.key;
      } catch { /* ignore */ }
    }

    // Fallback: command-center's own Supabase
    vars.SUPABASE_URL ??= process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    vars.SUPABASE_SERVICE_ROLE_KEY ??= process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    // Add metadata
    vars.TIRSA_TENANT_ID = tenantId;
    vars.TIRSA_COMMAND_CENTER_URL = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : DEFAULT_CC_URL;

    // Load tenant info
    const { data: tenant } = await sb
      .from("tenants")
      .select("name, slug")
      .eq("id", tenantId)
      .single();

    // Build .env content
    const lines = [
      `# ${brand.name} — Local Worker Configuration`,
      `# Generated for: ${(tenant as { name?: string } | null)?.name ?? "Unknown"}`,
      `# Date: ${new Date().toISOString()}`,
      "",
      "# Trigger.dev",
      `TRIGGER_PROJECT_ID=${vars.TRIGGER_PROJECT_ID ?? ""}`,
      `TRIGGER_SECRET_KEY=${vars.TRIGGER_SECRET_KEY ?? ""}`,
      ...(vars.TRIGGER_PROD_SECRET_KEY ? [`TRIGGER_PROD_SECRET_KEY=${vars.TRIGGER_PROD_SECRET_KEY}`] : []),
      "",
      "# Supabase",
      `SUPABASE_URL=${vars.SUPABASE_URL}`,
      `SUPABASE_SERVICE_ROLE_KEY=${vars.SUPABASE_SERVICE_ROLE_KEY}`,
      "",
      "# GitHub",
      ...(vars.GITHUB_TOKEN ? [`GITHUB_TOKEN=${vars.GITHUB_TOKEN}`] : ["# GITHUB_TOKEN="]),
      ...(vars.GITHUB_OWNER ? [`GITHUB_OWNER=${vars.GITHUB_OWNER}`] : ["# GITHUB_OWNER="]),
      "",
      "# LLM Providers",
      ...(vars.ANTHROPIC_API_KEY ? [`ANTHROPIC_API_KEY=${vars.ANTHROPIC_API_KEY}`] : ["# ANTHROPIC_API_KEY="]),
      ...(vars.OPENAI_API_KEY ? [`OPENAI_API_KEY=${vars.OPENAI_API_KEY}`] : ["# OPENAI_API_KEY="]),
      ...(vars.GEMINI_API_KEY ? [`GEMINI_API_KEY=${vars.GEMINI_API_KEY}`] : ["# GEMINI_API_KEY="]),
      "",
      `# ${brand.shortName} Metadata`,
      `TIRSA_TENANT_ID=${vars.TIRSA_TENANT_ID}`,
      `TIRSA_COMMAND_CENTER_URL=${vars.TIRSA_COMMAND_CENTER_URL}`,
      "",
    ];

    return new NextResponse(lines.join("\n"), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: unknown) {
    console.error("[cli/setup] error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const DEFAULT_CC_URL = "https://tirsa-factory.vercel.app";
