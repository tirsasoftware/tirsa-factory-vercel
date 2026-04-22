/**
 * PATCH  /api/projects/[id]  — update project (name, locked, repo_url)
 * DELETE /api/projects/[id]  — delete project (guards: not locked, not active)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { TP_BUCKET, sprintPath, localSprintPath, localProjectRoot } from "@/lib/paths";

export const dynamic = "force-dynamic";

// "waiting" = paused pending human approval — no background process running, safe to delete
const ACTIVE_STATUSES = ["executing", "running", "provisioning"];

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

async function assertMember(
  sb: ReturnType<typeof serviceClient>,
  userId: string,
  factoryId: string,
  roles = ["owner", "admin"],
) {
  const { data: factory } = await sb.from("factories").select("tenant_id").eq("id", factoryId).single();
  if (!factory) throw new Error("Factory not found");
  const { data: member } = await sb
    .from("tenant_members").select("role")
    .eq("tenant_id", factory.tenant_id).eq("user_id", userId).single();
  if (!member || !roles.includes(member.role as string)) throw new Error("Forbidden");
}

const TRIGGER_API = "https://api.trigger.dev";

/**
 * Cancel the active Trigger.dev pipeline run for a project so a user-requested
 * pause takes effect immediately rather than after the current agent finishes.
 *
 * Looks up the sprint's trigger_run_id, then calls the Trigger.dev cancel API.
 * Non-fatal — if cancellation fails we still honour the DB pause.
 */
async function cancelActiveTriggerRun(
  sb: ReturnType<typeof serviceClient>,
  projectId: string,
  sprintStatus: "paused" | "cancelled" | "completed" = "paused",
): Promise<void> {
  try {
    // Find the trigger_run_id of the currently running sprint
    const { data: sprint } = await sb
      .from("sprints")
      .select("id, trigger_run_id")
      .eq("project_id", projectId)
      .not("status", "in", '("completed","failed","cancelled","pending_save","paused")')
      .not("trigger_run_id", "is", null)
      .order("sprint_num", { ascending: false })
      .limit(1)
      .maybeSingle();

    const runId = sprint?.trigger_run_id as string | null;
    if (!runId) return;

    // Resolve Trigger.dev key (dev/prod split, with legacy fallback).
    // cancelActiveTriggerRun doesn't know the execution mode, so try
    // prod → dev → legacy until one is found.
    let triggerKey: string | undefined;
    const { data: project } = await sb
      .from("projects")
      .select("factory_id")
      .eq("id", projectId)
      .single();
    if (project) {
      const { data: factory } = await sb
        .from("factories")
        .select("tenant_id")
        .eq("id", project.factory_id)
        .single();
      if (factory) {
        const tid = factory.tenant_id as string;
        for (const varName of ["TRIGGER_PROD_SECRET_KEY", "TRIGGER_DEV_SECRET_KEY", "TRIGGER_SECRET_KEY"]) {
          const { data: row } = await sb
            .from("tenant_integrations")
            .select("secret_value")
            .eq("tenant_id", tid)
            .eq("service_id", "trigger")
            .eq("var_name", varName)
            .maybeSingle();
          if (row?.secret_value) {
            triggerKey = row.secret_value as string;
            break;
          }
        }
      }
    }
    if (!triggerKey) {
      triggerKey = process.env.TRIGGER_SECRET_KEY;
    }
    if (!triggerKey) return;

    // Cancel via Trigger.dev REST API — cancels parent run and all child runs
    await fetch(`${TRIGGER_API}/api/v1/runs/${runId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${triggerKey}` },
    });

    // Mark sprint with the requested terminal status
    await sb
      .from("sprints")
      .update({ status: sprintStatus, ...(sprintStatus !== "paused" ? { completed_at: new Date().toISOString() } : {}) })
      .eq("id", sprint!.id);

  } catch {
    // Non-fatal — DB pause already written; log omitted to avoid noise
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, sb } = await getUser(req);
    const { id } = await params;
    const body = await req.json() as { locked?: boolean; name?: string; repo_url?: string; status?: string; settings?: unknown; pipeline_id?: string | null; intake_brief?: string | null };

    const { data: project } = await sb.from("projects").select("factory_id").eq("id", id).single();
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await assertMember(sb, user.id, project.factory_id as string);

    const ALLOWED_STATUSES = ["ready", "queued", "paused", "cancelled", "completed"];
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.locked       !== undefined) patch.locked       = body.locked;
    if (body.name         !== undefined) patch.name         = body.name;
    if (body.repo_url     !== undefined) patch.repo_url     = body.repo_url;
    if (body.settings     !== undefined) patch.settings     = body.settings;
    if (body.intake_brief !== undefined) patch.intake_brief  = body.intake_brief;
    if (body.pipeline_id !== undefined) {
      patch.pipeline_id = body.pipeline_id;
      if (body.pipeline_id) {
        const { data: pl } = await sb.from("pipelines").select("steps").eq("id", body.pipeline_id).single();
        if (pl?.steps) patch.pipeline = pl.steps;
      } else {
        patch.pipeline = [];
      }
    }
    if (body.status !== undefined) {
      if (!ALLOWED_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` }, { status: 400 });
      }
      patch.status = body.status;
    }

    const { data, error } = await sb.from("projects").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);

    // Cancel the active Trigger.dev run when the user pauses, completes, or
    // cancels a project. Must happen BEFORE closing the sprint in the DB,
    // because cancelActiveTriggerRun queries for sprints not yet in a terminal
    // status — if we closed the sprint first, it would find nothing to cancel.
    if (body.status === "paused" || body.status === "completed" || body.status === "cancelled") {
      await cancelActiveTriggerRun(sb, id, body.status as "paused" | "cancelled" | "completed");
    }

    // When marking a project as completed, also close any open sprint.
    if (body.status === "completed") {
      await sb
        .from("sprints")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("project_id", id)
        .not("status", "in", '("completed","pending_save")');
    }

    return NextResponse.json({ project: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * Delete sprint artifacts from local filesystem and/or bucket.
 * Non-fatal — logs warnings but doesn't block deletion.
 */
async function cleanupSprintArtifacts(
  sb: SupabaseClient,
  sprint: { sprint_num: number; config?: Record<string, unknown> | null },
  tenantSlug: string,
  factorySlug: string,
  projectSlug: string,
): Promise<void> {
  const sprintNum = sprint.sprint_num;
  const config = (sprint.config ?? {}) as Record<string, unknown>;
  const mode = config.mode as string | undefined;
  const localBase = config.localBasePath as string | undefined;

  // Clean local filesystem
  if (localBase && tenantSlug && factorySlug) {
    try {
      const dir = localSprintPath(localBase, tenantSlug, factorySlug, projectSlug, sprintNum);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[cleanup] local sprint-${sprintNum} failed:`, (e as Error).message);
    }
  }

  // Clean bucket
  try {
    const prefix = sprintPath(tenantSlug, factorySlug, projectSlug, sprintNum);
    const { data } = await sb.storage.from(TP_BUCKET).list(prefix, { limit: 1000 });
    if (data && data.length > 0) {
      // Recursively collect all file paths
      const paths: string[] = [];
      const collect = async (pfx: string) => {
        const { data: items } = await sb.storage.from(TP_BUCKET).list(pfx, { limit: 1000 });
        for (const item of items ?? []) {
          const full = `${pfx}/${item.name}`;
          if (!item.id) await collect(full);
          else paths.push(full);
        }
      };
      await collect(prefix);
      if (paths.length > 0) {
        const BATCH = 100;
        for (let i = 0; i < paths.length; i += BATCH) {
          await sb.storage.from(TP_BUCKET).remove(paths.slice(i, i + BATCH));
        }
      }
    }
  } catch (e) {
    console.warn(`[cleanup] bucket sprint-${sprintNum} failed:`, (e as Error).message);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, sb } = await getUser(req);
    const { id } = await params;

    const { data: project } = await sb
      .from("projects")
      .select("factory_id, status, locked, name, slug")
      .eq("id", id)
      .single();

    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await assertMember(sb, user.id, project.factory_id as string);

    if (project.locked) {
      return NextResponse.json(
        { error: "Project is locked. Unlock it first before deleting." },
        { status: 403 },
      );
    }

    if (ACTIVE_STATUSES.includes(project.status as string)) {
      return NextResponse.json(
        { error: `Cannot delete a project that is currently ${project.status}. Stop it first.` },
        { status: 409 },
      );
    }

    const projectSlug = project.slug as string;

    // Resolve tenant/factory slugs
    const { data: factory } = await sb.from("factories").select("tenant_id, slug").eq("id", project.factory_id).single();
    const factorySlug = factory?.slug as string ?? "";
    const { data: tenant } = await sb.from("tenants").select("slug").eq("id", factory?.tenant_id).single();
    const tenantSlug = tenant?.slug as string ?? "";

    // Load all sprints for artifact cleanup
    const { data: sprints } = await sb.from("sprints").select("id, sprint_num, config").eq("project_id", id);

    // Clean artifacts for each sprint (local + bucket)
    for (const sprint of sprints ?? []) {
      await cleanupSprintArtifacts(sb, sprint as { sprint_num: number; config?: Record<string, unknown> | null }, tenantSlug, factorySlug, projectSlug);
    }

    // Clean local project root (non-fatal)
    try {
      // Resolve localBase from tenant storage integrations
      const { data: storageInts } = await sb.from("tenant_integrations").select("secret_value").eq("tenant_id", factory?.tenant_id).eq("service_id", "storage");
      for (const row of storageInts ?? []) {
        try {
          const cfg = JSON.parse(row.secret_value as string) as { type?: string; basePath?: string };
          if (cfg.type === "local" && cfg.basePath && tenantSlug && factorySlug) {
            const projRoot = localProjectRoot(cfg.basePath, tenantSlug, factorySlug, projectSlug);
            if (existsSync(projRoot)) rmSync(projRoot, { recursive: true, force: true });
            break;
          }
        } catch { /* ignore */ }
      }
    } catch (e) {
      console.warn("[cleanup] local project root failed:", (e as Error).message);
    }

    // Cascade: events → runs → sprints → project
    const { data: runs } = await sb.from("agent_runs").select("id").eq("project_id", id);
    if (runs && runs.length > 0) {
      await sb.from("agent_events").delete().in("run_id", runs.map((r) => r.id));
      await sb.from("agent_runs").delete().eq("project_id", id);
    }
    await sb.from("sprints").delete().eq("project_id", id);
    await sb.from("projects").delete().eq("id", id);

    return NextResponse.json({ ok: true, deleted: id });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
