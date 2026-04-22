/**
 * POST /api/projects/[id]/sprints/[sprintId]/save
 *
 * Resolves a sprint that is in "pending_save" status.
 *
 * Body: { action: "github" | "download" | "discard" }
 *
 * - github:   Commits sprint artifacts to GitHub via the REST API.
 *             Commit: "feat: add sprint-<n>", tag: "sprint-<n>", branch: main.
 *             Reads from local filesystem (TwinPilotProjects/.../staging/sprint-<n>/) or Supabase bucket.
 * - download: Fetches all staged files from Supabase storage, returns a zip as application/zip.
 * - discard:  Deletes staging artifacts (local dir or Supabase objects) and closes the sprint.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { brand } from "@/lib/brand";
import { deflateRawSync } from "node:zlib";
import { readdirSync, statSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { TP_BUCKET, sprintPath, localSprintPath, isWithinBase } from "@/lib/paths";

export const dynamic = "force-dynamic";

const GH_API = "https://api.github.com";

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function getUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const sb = serviceClient();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) throw new Error("Unauthorized");
  return { user, sb };
}

// ─── Minimal ZIP writer (no external deps) ────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: { name: string; content: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const central: Buffer[]    = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes  = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.content, { level: 6 });
    const crc        = crc32(file.content);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);  local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(compressed.length, 20); cd.writeUInt32LE(file.content.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);

    localParts.push(local, compressed);
    central.push(cd);
    offset += local.length + compressed.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd  = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

// ─── Local filesystem helpers ─────────────────────────────────────────────────

/** Recursively read all files under dir; returns relative paths + content. */
function readDirRecursive(dir: string, rel = ""): { path: string; content: string }[] {
  const result: { path: string; content: string }[] = [];
  if (!existsSync(dir)) return result;
  for (const name of readdirSync(dir)) {
    // Skip hidden directories and most dot-files, but allow .gitignore
    if (name === "node_modules") continue;
    if (name.startsWith(".") && name !== ".gitignore") continue;
    const full    = join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) {
      result.push(...readDirRecursive(full, relPath));
    } else {
      try { result.push({ path: relPath, content: readFileSync(full, "utf-8") }); } catch { /* skip binary */ }
    }
  }
  return result;
}

// ─── Supabase storage helpers ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listStorageAll(client: any, bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const paths: string[] = [];
  for (const item of data) {
    const full = `${prefix}/${item.name}`;
    if (!item.id) paths.push(...await listStorageAll(client, bucket, full));
    else paths.push(full);
  }
  return paths;
}

// ─── GitHub REST API helpers ──────────────────────────────────────────────────

async function ghFetch(
  path: string,
  token: string,
  opts?: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "tirsa-factory",
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function githubPushSprint(opts: {
  token: string;
  owner: string;
  repo: string;
  sprintNum: number;
  branch: string;
  files: { path: string; content: string }[];
}): Promise<void> {
  const { token, owner, repo, sprintNum, branch, files } = opts;
  const sprintLabel = `sprint-${sprintNum}`;

  if (files.length === 0) throw new Error("No files to commit.");

  // Get current HEAD of the target branch (may not exist for a fresh repo)
  const refResult = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);

  let baseCommitSha: string | null = null;
  let baseTreeSha:   string | null = null;

  if (refResult.ok) {
    baseCommitSha = (refResult.data as { object: { sha: string } }).object.sha;
    const commitResult = await ghFetch(`/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, token);
    if (!commitResult.ok) throw new Error(`Could not fetch base commit: ${JSON.stringify(commitResult.data)}`);
    baseTreeSha = (commitResult.data as { tree: { sha: string } }).tree.sha;
  } else if (refResult.status !== 404) {
    throw new Error(`Could not get ${branch} branch: ${JSON.stringify(refResult.data)}`);
  }
  // status 404 → repo is empty or branch doesn't exist yet → first commit

  // Create blobs
  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const file of files) {
    // encode content as base64 to safely handle any text encoding
    const b64 = Buffer.from(file.content, "utf-8").toString("base64");
    const blobResult = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, token, {
      method: "POST",
      body: JSON.stringify({ content: b64, encoding: "base64" }),
    });
    if (!blobResult.ok) throw new Error(`Failed to create blob for ${file.path}: ${JSON.stringify(blobResult.data)}`);
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha:  (blobResult.data as { sha: string }).sha,
    });
  }

  // Create tree
  const treeBody: Record<string, unknown> = { tree: treeItems };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;

  const treeResult = await ghFetch(`/repos/${owner}/${repo}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify(treeBody),
  });
  if (!treeResult.ok) throw new Error(`Failed to create tree: ${JSON.stringify(treeResult.data)}`);
  const newTreeSha = (treeResult.data as { sha: string }).sha;

  // Create commit
  const commitBody: Record<string, unknown> = {
    message: `feat: add ${sprintLabel}`,
    tree:    newTreeSha,
    ...(baseCommitSha ? { parents: [baseCommitSha] } : { parents: [] }),
  };
  const newCommitResult = await ghFetch(`/repos/${owner}/${repo}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify(commitBody),
  });
  if (!newCommitResult.ok) throw new Error(`Failed to create commit: ${JSON.stringify(newCommitResult.data)}`);
  const newCommitSha = (newCommitResult.data as { sha: string }).sha;

  // Update (or create) branch ref
  if (baseCommitSha) {
    const patchResult = await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommitSha }),
    });
    if (!patchResult.ok) throw new Error(`Failed to update ${branch}: ${JSON.stringify(patchResult.data)}`);
  } else {
    const createResult = await ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommitSha }),
    });
    if (!createResult.ok) throw new Error(`Failed to create ${branch} ref: ${JSON.stringify(createResult.data)}`);
  }

  // Create tag (best-effort — ignore if it already exists)
  await ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/tags/${sprintLabel}`, sha: newCommitSha }),
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sprintId: string }> },
) {
  try {
    const { user, sb } = await getUser(req);
    const { id: projectId, sprintId } = await params;
    const body = await req.json() as {
      action: "export" | "discard" | "close" | "github" | "download" | "save";
      targets?: string[];
    };

    const validActions = ["export", "discard", "close", "github", "download", "save"];
    if (!validActions.includes(body.action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // ── Load project + verify membership ──────────────────────────────────────
    const { data: project } = await sb
      .from("projects")
      .select("id, name, slug, factory_id, pipeline, settings, repo_url")
      .eq("id", projectId)
      .single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { data: factory } = await sb
      .from("factories").select("tenant_id, slug").eq("id", project.factory_id).single();
    if (!factory) return NextResponse.json({ error: "Factory not found" }, { status: 404 });

    const { data: member } = await sb
      .from("tenant_members").select("role")
      .eq("tenant_id", factory.tenant_id).eq("user_id", user.id).single();
    if (!member || !["owner", "admin"].includes(member.role as string)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Resolve tenant slug
    const { data: tenant } = await sb.from("tenants").select("slug").eq("id", factory.tenant_id).single();
    const tenantSlug  = tenant?.slug as string;
    const factorySlug = factory.slug as string;

    // ── Load sprint ───────────────────────────────────────────────────────────
    const { data: sprint } = await sb
      .from("sprints")
      .select("id, sprint_num, status, sprint_completed_saved, config")
      .eq("id", sprintId)
      .eq("project_id", projectId)
      .single();
    if (!sprint) return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
    if (sprint.status !== "pending_save" && sprint.sprint_completed_saved !== false) {
      return NextResponse.json({ error: "Sprint is not pending save" }, { status: 409 });
    }

    const projectSlug      = project.slug as string;
    const sprintNum        = sprint.sprint_num as number;
    const sprintConfig     = (sprint.config ?? {}) as Record<string, unknown>;
    const settings         = (project.settings ?? {}) as Record<string, unknown>;
    const storageName      = settings.storage_backend_name as string | undefined;
    const cliAgents        = (settings.cli_agents ?? {}) as Record<string, unknown>;
    const sprintMode       = sprintConfig.mode as string | undefined;
    const storageType      = sprintMode === "local" ? "local"
      : (cliAgents.execution_backend as "supabase" | "local" | undefined) ?? "supabase";
    const localBaseFromCli = cliAgents.local_base_path as string | undefined;
    const githubBranch     = (settings.github_branch as string | undefined) ?? "main";

    // ── Resolve local backend config ─────────────────────────────────────────
    // Priority: sprint config → project settings → tenant storage integrations
    let localBasePath: string | null = sprintConfig.localBasePath as string | null ?? null;
    let supabaseUrl:   string | null = null;
    let supabaseKey:   string | null = null;

    if (!localBasePath && localBaseFromCli) localBasePath = localBaseFromCli;

    if (storageName) {
      const { data: integration } = await sb
        .from("tenant_integrations")
        .select("secret_value")
        .eq("tenant_id", factory.tenant_id)
        .eq("service_id", "storage")
        .eq("var_name", storageName)
        .single();

      if (integration?.secret_value) {
        try {
          const cfg = JSON.parse(integration.secret_value as string) as {
            type: string; basePath?: string; url?: string; key?: string;
          };
          if (cfg.type === "local" && !localBasePath) localBasePath = cfg.basePath ?? null;
          if (cfg.type === "supabase") { supabaseUrl = cfg.url ?? null; supabaseKey = cfg.key ?? null; }
        } catch { /* use defaults */ }
      }
    }

    // Fallback: scan all storage integrations for local type
    if (!localBasePath) {
      const { data: storageInts } = await sb
        .from("tenant_integrations")
        .select("secret_value")
        .eq("tenant_id", factory.tenant_id)
        .eq("service_id", "storage");
      for (const row of storageInts ?? []) {
        try {
          const cfg = JSON.parse(row.secret_value as string) as { type?: string; basePath?: string };
          if (cfg.type === "local" && cfg.basePath) { localBasePath = cfg.basePath; break; }
        } catch { /* ignore */ }
      }
    }

    function getStagingDir(): string | null {
      if (!localBasePath || !tenantSlug || !factorySlug) return null;
      const dir = localSprintPath(localBasePath, tenantSlug, factorySlug, projectSlug, sprintNum);
      if (!isWithinBase(resolve(dir), localBasePath)) return null;
      return dir;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GITHUB — commit sprint artifacts directly via REST API
    // ─────────────────────────────────────────────────────────────────────────
    if (body.action === "github") {
      // Resolve GITHUB_TOKEN + GITHUB_OWNER from tenant_integrations or env
      const { data: integrations } = await sb
        .from("tenant_integrations")
        .select("var_name, secret_value")
        .eq("tenant_id", factory.tenant_id);

      const envVars: Record<string, string> = {};
      for (const row of integrations ?? []) {
        if (row.var_name && row.secret_value) envVars[row.var_name as string] = row.secret_value as string;
      }
      const githubToken = envVars["GITHUB_TOKEN"];
      if (!githubToken) return NextResponse.json({ error: "GITHUB_TOKEN not configured in integrations." }, { status: 422 });
      const githubOwner = envVars["GITHUB_OWNER"];

      let repoUrl = project.repo_url as string | null;

      // Auto-create repo if repo_url is not set
      if (!repoUrl && githubOwner) {
        const factorySlug = (factory.slug as string) ?? "tirsa";
        const repoName = `${factorySlug}-${projectSlug}`;
        const headers = { Authorization: `token ${githubToken}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" };

        // Check if repo already exists
        const checkRes = await fetch(`https://api.github.com/repos/${githubOwner}/${repoName}`, { headers });
        if (checkRes.ok) {
          const checkData = await checkRes.json() as { html_url: string };
          repoUrl = checkData.html_url;
        } else {
          // Detect if owner is org or user
          const ownerRes = await fetch(`https://api.github.com/users/${githubOwner}`, { headers });
          const ownerData = await ownerRes.json() as { type?: string };
          const isOrg = ownerData.type === "Organization";

          const createUrl = isOrg
            ? `https://api.github.com/orgs/${githubOwner}/repos`
            : "https://api.github.com/user/repos";
          const createRes = await fetch(createUrl, {
            method: "POST", headers,
            body: JSON.stringify({
              name: repoName,
              description: `${project.name as string ?? projectSlug} — managed by ${brand.name}`,
              private: true,
              auto_init: true,
            }),
          });
          if (createRes.ok || createRes.status === 201) {
            const createData = await createRes.json() as { html_url: string };
            repoUrl = createData.html_url;
          } else {
            const err = await createRes.text().catch(() => "");
            return NextResponse.json({ error: `Failed to create GitHub repo: ${err}` }, { status: 422 });
          }
        }

        // Persist repo_url
        if (repoUrl) {
          await sb.from("projects").update({ repo_url: repoUrl }).eq("id", projectId);
        }
      }

      if (!repoUrl) return NextResponse.json({ error: "GitHub not configured. Set GITHUB_TOKEN and GITHUB_OWNER in Storage → GitHub." }, { status: 422 });

      const ghMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (!ghMatch) return NextResponse.json({ error: "Could not parse GitHub repo URL." }, { status: 422 });
      const [, owner, repo] = ghMatch as [string, string, string];

      // Collect files
      let files: { path: string; content: string }[] = [];

      if (storageType === "local") {
        const stagingDir = getStagingDir();
        if (!stagingDir) {
          return NextResponse.json({
            error: "Staging directory not found. Check your local storage configuration.",
          }, { status: 404 });
        }
        files = readDirRecursive(stagingDir);
      } else {
        // Supabase storage
        const storageClient = (supabaseUrl && supabaseKey)
          ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
          : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
        const bucket = (supabaseUrl && supabaseKey) ? "staging" : TP_BUCKET;
        const prefix = (tenantSlug && factorySlug) ? sprintPath(tenantSlug, factorySlug, projectSlug, sprintNum) : `${projectSlug}/sprint-${sprintNum}`;

        const storagePaths = await listStorageAll(storageClient, bucket, prefix);
        for (const p of storagePaths) {
          const { data } = await storageClient.storage.from(bucket).download(p);
          if (data) files.push({ path: p.slice(prefix.length + 1), content: await data.text() });
        }
      }

      if (files.length === 0) {
        return NextResponse.json({ error: "No files found to commit." }, { status: 404 });
      }

      // Auto-inject README.md and .gitignore if not present in staging
      const sprintLabel = `sprint-${sprintNum}`;
      if (!files.some((f) => f.path === "README.md")) {
        const agentList = [...new Set(
          files
            .map((f) => f.path.split("/")[1])
            .filter((s): s is string => Boolean(s) && s !== "summary.md"),
        )].join(", ");
        files.push({
          path: "README.md",
          content: `# ${project.name as string} — ${sprintLabel}\n\n` +
            `Sprint generated by [${brand.name}](${brand.urls.website}).\n\n` +
            `## Agents\n\n${agentList || "(none)"}\n\n` +
            `## Structure\n\n` +
            `- \`_audit/\` — per-agent summaries\n` +
            `- \`_docs/\` — documents and specifications\n` +
            `- \`_workspace/\` — implementation artifacts\n`,
        });
      }
      if (!files.some((f) => f.path === ".gitignore")) {
        files.push({
          path: ".gitignore",
          content: `staging/\n.tp/\n.claude/\n.mcp.json\nCLAUDE.md\nnode_modules/\n`,
        });
      }

      await githubPushSprint({ token: githubToken, owner, repo, sprintNum, branch: githubBranch, files });

      await sb.from("sprints")
        .update({ status: "completed", sprint_completed_saved: true, completed_at: new Date().toISOString() })
        .eq("id", sprintId);
      await sb.from("projects").update({ status: "completed" }).eq("id", projectId);

      try { const { createNotification } = await import("@/lib/notifications"); await createNotification({ tenantId: factory.tenant_id as string, eventType: "sprint_completed", severity: "info", title: `Sprint completed — ${project.name as string}`, body: "Pushed to GitHub", metadata: { projectId, sprintId } }); } catch { /* non-blocking */ }
      return NextResponse.json({ ok: true, action: "github" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DISCARD — delete staging artifacts, close sprint
    // ─────────────────────────────────────────────────────────────────────────
    if (body.action === "discard") {
      if (storageType === "local") {
        const stagingDir = getStagingDir();
        if (stagingDir) try { rmSync(stagingDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
      } else {
        // Supabase: delete sprint objects from bucket
        try {
          const storageClient = (supabaseUrl && supabaseKey)
            ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
            : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
          const bucket = (supabaseUrl && supabaseKey) ? "staging" : TP_BUCKET;
          const prefix = (tenantSlug && factorySlug) ? sprintPath(tenantSlug, factorySlug, projectSlug, sprintNum) : `${projectSlug}/sprint-${sprintNum}`;

          const storagePaths = await listStorageAll(storageClient, bucket, prefix);
          if (storagePaths.length > 0) {
            await storageClient.storage.from(bucket).remove(storagePaths);
          }
        } catch { /* non-fatal */ }
      }

      await sb.from("sprints")
        .update({ status: "completed", sprint_completed_saved: false, completed_at: new Date().toISOString() })
        .eq("id", sprintId);
      await sb.from("projects").update({ status: "completed" }).eq("id", projectId);
      try { const { createNotification } = await import("@/lib/notifications"); await createNotification({ tenantId: factory.tenant_id as string, eventType: "sprint_completed", severity: "info", title: `Sprint completed — ${project.name as string}`, body: "Discarded", metadata: { projectId, sprintId } }); } catch { /* non-blocking */ }
      return NextResponse.json({ ok: true, action: "discard" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DOWNLOAD — zip files from Supabase storage
    // ─────────────────────────────────────────────────────────────────────────
    if (body.action === "download") {
      const storageClient = (supabaseUrl && supabaseKey)
        ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
        : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const bucket = (supabaseUrl && supabaseKey) ? "staging" : TP_BUCKET;
      const prefix = (tenantSlug && factorySlug) ? sprintPath(tenantSlug, factorySlug, projectSlug, sprintNum) : `${projectSlug}/sprint-${sprintNum}`;

      const storagePaths = await listStorageAll(storageClient, bucket, prefix);
      const zipFiles: { name: string; content: Buffer }[] = [];

      for (const p of storagePaths) {
        const { data } = await storageClient.storage.from(bucket).download(p);
        if (!data) continue;
        const relPath = p.slice(prefix.length + 1);
        zipFiles.push({ name: relPath, content: Buffer.from(await data.arrayBuffer()) });
      }

      if (zipFiles.length === 0) {
        return NextResponse.json({ error: "No files found in staging storage for this sprint." }, { status: 404 });
      }

      const zipBuffer = makeZip(zipFiles);

      await sb.from("sprints")
        .update({ status: "completed", sprint_completed_saved: true, completed_at: new Date().toISOString() })
        .eq("id", sprintId);
      await sb.from("projects").update({ status: "completed" }).eq("id", projectId);

      const filename = `${projectSlug}-sprint-${sprintNum}.zip`;
      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type":        "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length":      String(zipBuffer.length),
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SAVE / CLOSE — keep artifacts in bucket, just close the sprint
    // ─────────────────────────────────────────────────────────────────────────
    if (body.action === "save" || body.action === "close") {
      await sb.from("sprints")
        .update({ status: "completed", sprint_completed_saved: true, completed_at: new Date().toISOString() })
        .eq("id", sprintId);
      await sb.from("projects").update({ status: "completed" }).eq("id", projectId);
      try { const { createNotification } = await import("@/lib/notifications"); await createNotification({ tenantId: factory.tenant_id as string, eventType: "sprint_completed", severity: "info", title: `Sprint completed — ${project.name as string}`, body: "Closed", metadata: { projectId, sprintId } }); } catch { /* non-blocking */ }
      return NextResponse.json({ ok: true, action: body.action });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPORT — execute multiple targets, then close sprint
    // ─────────────────────────────────────────────────────────────────────────
    if (body.action === "export") {
      const targets = body.targets ?? [];
      if (targets.length === 0) {
        return NextResponse.json({ error: "No export targets specified" }, { status: 400 });
      }

      const results: { target: string; ok: boolean; error?: string }[] = [];

      // ── Collect files (local filesystem or bucket) ─────────────────────
      let files: { path: string; content: string }[] = [];

      const stagingDir = getStagingDir();
      if (storageType === "local" && stagingDir && existsSync(stagingDir)) {
        // Local mode — read from filesystem
        files = readDirRecursive(stagingDir);
      } else {
        // Cloud mode — read from Supabase bucket
        const storageClient = (supabaseUrl && supabaseKey)
          ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
          : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
        const bucket = (supabaseUrl && supabaseKey) ? "staging" : TP_BUCKET;
        const prefix = (tenantSlug && factorySlug) ? sprintPath(tenantSlug, factorySlug, projectSlug, sprintNum) : `${projectSlug}/sprint-${sprintNum}`;

        const storagePaths = await listStorageAll(storageClient, bucket, prefix);
        for (const p of storagePaths) {
          const { data } = await storageClient.storage.from(bucket).download(p);
          if (data) files.push({ path: p.slice(prefix.length + 1), content: await data.text() });
        }
      }

      // ── GitHub target ──────────────────────────────────────────────────
      if (targets.includes("github")) {
        try {
          const { data: integrations } = await sb
            .from("tenant_integrations")
            .select("var_name, secret_value")
            .eq("tenant_id", factory.tenant_id);
          const envVars: Record<string, string> = {};
          for (const row of integrations ?? []) {
            if (row.var_name && row.secret_value) envVars[row.var_name as string] = row.secret_value as string;
          }
          const githubToken = envVars["GITHUB_TOKEN"];
          const githubOwner = envVars["GITHUB_OWNER"];
          const githubBranch = (settings.github_branch as string | undefined) ?? "main";

          if (!githubToken) {
            results.push({ target: "github", ok: false, error: "GITHUB_TOKEN not configured" });
          } else {
            let repoUrl = project.repo_url as string | null;

            // Auto-create repo if needed
            if (!repoUrl && githubOwner) {
              const factorySlug = (factory.slug as string) ?? "factory";
              const repoName = `${factorySlug}-${projectSlug}`;
              const headers = { Authorization: `token ${githubToken}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" };
              const checkRes = await fetch(`https://api.github.com/repos/${githubOwner}/${repoName}`, { headers });
              if (checkRes.ok) {
                repoUrl = ((await checkRes.json()) as { html_url: string }).html_url;
              } else {
                const ownerRes = await fetch(`https://api.github.com/users/${githubOwner}`, { headers });
                const isOrg = ((await ownerRes.json()) as { type?: string }).type === "Organization";
                const createUrl = isOrg ? `https://api.github.com/orgs/${githubOwner}/repos` : "https://api.github.com/user/repos";
                const createRes = await fetch(createUrl, {
                  method: "POST", headers,
                  body: JSON.stringify({ name: repoName, description: `${project.name as string ?? projectSlug}`, private: true, auto_init: true }),
                });
                if (createRes.ok || createRes.status === 201) {
                  repoUrl = ((await createRes.json()) as { html_url: string }).html_url;
                }
              }
              if (repoUrl) await sb.from("projects").update({ repo_url: repoUrl }).eq("id", projectId);
            }

            if (!repoUrl) {
              results.push({ target: "github", ok: false, error: "No repo URL configured" });
            } else {
              const ghMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
              if (!ghMatch) {
                results.push({ target: "github", ok: false, error: "Cannot parse repo URL" });
              } else {
                // Use shared files array + auto-inject README/.gitignore
                const ghFiles = [...files];
                if (!ghFiles.some((f) => f.path === "README.md")) {
                  ghFiles.push({ path: "README.md", content: `# ${project.name as string} — sprint-${sprintNum}\n\nGenerated by ${brand.name}.\n` });
                }
                if (!ghFiles.some((f) => f.path === ".gitignore")) {
                  ghFiles.push({ path: ".gitignore", content: `staging/\n.tp/\n.claude/\n.mcp.json\nCLAUDE.md\nnode_modules/\n` });
                }

                const [, owner, repo] = ghMatch as [string, string, string];
                await githubPushSprint({ token: githubToken, owner, repo, sprintNum, branch: githubBranch, files: ghFiles });
                results.push({ target: "github", ok: true });
              }
            }
          }
        } catch (e) {
          results.push({ target: "github", ok: false, error: (e as Error).message });
        }
      }

      // ── Download ZIP target (must be last — returns binary) ────────────
      if (targets.includes("download")) {
        const zipFiles = files.map((f) => ({
          name: f.path,
          content: Buffer.from(f.content, "utf-8"),
        }));

        if (zipFiles.length > 0) {
          // Close sprint before sending zip
          await sb.from("sprints")
            .update({ status: "completed", sprint_completed_saved: true, completed_at: new Date().toISOString() })
            .eq("id", sprintId);
          await sb.from("projects").update({ status: "completed" }).eq("id", projectId);

          const zipBuffer = makeZip(zipFiles);
          const filename = `${projectSlug}-sprint-${sprintNum}.zip`;
          return new NextResponse(new Uint8Array(zipBuffer), {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Content-Length": String(zipBuffer.length),
              "X-Export-Results": JSON.stringify(results),
            },
          });
        } else {
          results.push({ target: "download", ok: false, error: "No files found" });
        }
      }

      // Close sprint
      await sb.from("sprints")
        .update({ status: "completed", sprint_completed_saved: true, completed_at: new Date().toISOString() })
        .eq("id", sprintId);
      await sb.from("projects").update({ status: "completed" }).eq("id", projectId);
      try { const { createNotification } = await import("@/lib/notifications"); await createNotification({ tenantId: factory.tenant_id as string, eventType: "sprint_completed", severity: "info", title: `Sprint completed — ${project.name as string}`, body: `Exported to: ${targets.join(", ")}`, metadata: { projectId, sprintId } }); } catch { /* non-blocking */ }

      return NextResponse.json({ ok: true, action: "export", results });
    }

    return NextResponse.json({ error: "Unhandled action" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
