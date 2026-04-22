/**
 * GET /api/cli/worker-bundle?token=<setup-token>
 *
 * Proxies the control-plane source from GitHub as a tarball.
 * The source is fetched from the GitHub API (not from local filesystem,
 * since Vercel only deploys the command-center).
 *
 * Authenticated via the same token used by /api/cli/setup.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminConfig } from "@/lib/admin-config";

export const dynamic = "force-dynamic";

const REPO_OWNER = "tirsasoftware";
const REPO_NAME  = "tirsa-factory";
const BRANCH     = "main";

/** Paths to include in the worker bundle */
const INCLUDE_PATHS = [
  "trigger.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "services/control-plane/",
];

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function validateToken(token: string): Promise<boolean> {
  const sb = serviceClient();
  const { data: row1 } = await sb
    .from("tenant_integrations")
    .select("tenant_id")
    .eq("service_id", "cli")
    .eq("var_name", "SETUP_TOKEN")
    .eq("secret_value", token)
    .maybeSingle();
  if (row1) return true;

  const { data: row2 } = await sb
    .from("tenant_integrations")
    .select("tenant_id")
    .eq("service_id", "cli")
    .eq("var_name", "TIRSA_API_KEY")
    .eq("secret_value", token)
    .maybeSingle();
  return Boolean(row2);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token parameter required" }, { status: 400 });
  }

  const valid = await validateToken(token);
  if (!valid) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    // Use GITHUB_ADMIN_TOKEN or process.env for GitHub API access
    const ghToken = await getAdminConfig("GITHUB_ADMIN_TOKEN") ?? process.env.GITHUB_ADMIN_TOKEN;
    if (!ghToken) {
      return NextResponse.json({ error: "Platform GitHub token not configured" }, { status: 500 });
    }

    // Download repo tarball from GitHub
    const tarballUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/tarball/${BRANCH}`;
    const res = await fetch(tarballUrl, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `GitHub API returned ${res.status}` },
        { status: 502 },
      );
    }

    // GitHub returns a .tar.gz — we'll forward it directly
    // The CLI will extract only the needed paths
    const tarball = await res.arrayBuffer();

    return new NextResponse(Buffer.from(tarball), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": "attachment; filename=tirsa-factory-worker.tar.gz",
        "Content-Length": String(tarball.byteLength),
      },
    });
  } catch (e: unknown) {
    console.error("[worker-bundle] error:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
