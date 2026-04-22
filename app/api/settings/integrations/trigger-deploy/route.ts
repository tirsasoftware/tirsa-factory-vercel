/**
 * POST /api/settings/integrations/trigger-deploy
 *   1. Injects TRIGGER_ACCESS_TOKEN as a GitHub Actions secret (encrypted)
 *   2. Dispatches the deploy-tasks.yml workflow
 *
 * GET /api/settings/integrations/trigger-deploy?tenantId=...
 *   Returns the latest deployment status (workflow run state).
 *
 * Secrets are never passed as workflow inputs — they're injected via the
 * GitHub Secrets API and referenced as ${{ secrets.TRIGGER_ACCESS_TOKEN }}.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminConfig } from "@/lib/admin-config";

export const dynamic = "force-dynamic";

const REPO_OWNER    = "tirsasoftware";
const REPO_NAME     = "tirsa-factory";
const WORKFLOW_FILE = "deploy-tasks.yml";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function assertMember(req: NextRequest, tenantId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const sb = serviceClient();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  const { data: member } = await sb.from("tenant_members").select("id").eq("tenant_id", tenantId).eq("user_id", user.id).single();
  if (!member) throw new Error("Forbidden");
}

async function getSecret(tenantId: string, serviceId: string, varName: string): Promise<string | null> {
  const sb = serviceClient();
  const { data } = await sb
    .from("tenant_integrations")
    .select("secret_value")
    .eq("tenant_id", tenantId)
    .eq("service_id", serviceId)
    .eq("var_name", varName)
    .single();
  return (data as { secret_value?: string } | null)?.secret_value ?? null;
}

/* ─── Encrypt a secret for the GitHub Actions Secrets API ──────────────────── */

async function encryptSecret(publicKey: string, secretValue: string): Promise<string> {
  // GitHub requires libsodium sealed-box encryption (crypto_box_seal).
  const _sodium = await import("libsodium-wrappers").then((m) => m.default ?? m);
  await _sodium.ready;

  const keyBytes = _sodium.from_base64(publicKey, _sodium.base64_variants.ORIGINAL);
  const secretBytes = _sodium.from_string(secretValue);
  const encrypted = _sodium.crypto_box_seal(secretBytes, keyBytes);

  return _sodium.to_base64(encrypted, _sodium.base64_variants.ORIGINAL);
}

/** Set a GitHub Actions secret on the repo */
async function setGitHubSecret(ghToken: string, secretName: string, secretValue: string): Promise<void> {
  // 1. Get repo public key
  const pkRes = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/secrets/public-key`,
    {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!pkRes.ok) {
    throw new Error(`Failed to get repo public key (HTTP ${pkRes.status})`);
  }
  const { key: publicKey, key_id: keyId } = await pkRes.json() as { key: string; key_id: string };

  // 2. Encrypt the secret
  const encryptedValue = await encryptSecret(publicKey, secretValue);

  // 3. Create or update the secret
  const putRes = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/secrets/${secretName}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        encrypted_value: encryptedValue,
        key_id: keyId,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => "");
    throw new Error(`Failed to set GitHub secret ${secretName} (HTTP ${putRes.status}): ${detail}`);
  }
}

/* ─── POST — deploy workers ────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  let body: { tenantId: string };
  try {
    body = await req.json() as { tenantId: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tenantId } = body;
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  try {
    await assertMember(req, tenantId);
    // 1. Read Trigger.dev credentials
    const projectId = await getSecret(tenantId, "trigger", "TRIGGER_PROJECT_ID");
    const accessToken = await getSecret(tenantId, "trigger", "TRIGGER_ACCESS_TOKEN");
    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "Configure Trigger.dev Project ref first" },
        { status: 400 },
      );
    }
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "Configure Trigger.dev Personal Access Token first (Account → Tokens)" },
        { status: 400 },
      );
    }

    // 2. Get GitHub admin token
    const ghToken = await getAdminConfig("GITHUB_ADMIN_TOKEN") ?? process.env.GITHUB_ADMIN_TOKEN;
    if (!ghToken) {
      return NextResponse.json(
        { ok: false, error: "Platform configuration issue — contact support" },
        { status: 500 },
      );
    }

    // 3. Inject TRIGGER_ACCESS_TOKEN as a GitHub Actions secret
    await setGitHubSecret(ghToken, "TRIGGER_ACCESS_TOKEN", accessToken);

    // 4. Dispatch the workflow
    const dispatchUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
    const res = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          trigger_project_id: projectId,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 204 || res.status === 200) {
      return NextResponse.json({ ok: true });
    }

    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { ok: false, error: `GitHub API returned HTTP ${res.status}: ${detail}` },
      { status: 502 },
    );
  } catch (e: unknown) {
    console.error("[trigger-deploy] POST error:", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/* ─── GET — check latest deploy status ─────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  try {
    await assertMember(req, tenantId);
    const ghToken = await getAdminConfig("GITHUB_ADMIN_TOKEN") ?? process.env.GITHUB_ADMIN_TOKEN;
    if (!ghToken) {
      return NextResponse.json({ status: "unknown", error: "Platform configuration issue" });
    }

    // Fetch the latest workflow run for deploy-tasks.yml
    const runsUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`;
    const res = await fetch(runsUrl, {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return NextResponse.json({ status: "unknown", error: `GitHub API returned ${res.status}` });
    }

    const body = await res.json() as { workflow_runs?: { status: string; conclusion: string | null; html_url: string; created_at: string }[] };
    const latest = body.workflow_runs?.[0];

    if (!latest) {
      return NextResponse.json({ status: "none" });
    }

    return NextResponse.json({
      status: latest.conclusion ?? latest.status,
      runUrl: latest.html_url,
      updatedAt: latest.created_at,
    });
  } catch (e: unknown) {
    return NextResponse.json({ status: "unknown", error: (e as Error).message });
  }
}
