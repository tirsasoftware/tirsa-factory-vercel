/**
 * DELETE /api/projects/[id]/sprints/[sprintId]
 *
 * Deletes a single sprint: removes artifacts from local filesystem and/or bucket,
 * then deletes agent_events, agent_runs, and the sprint record.
 *
 * Guards: sprint must not be actively running.
 * Auth: Bearer {supabase access_token}, must be tenant member.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { existsSync, rmSync } from "fs";
import { TP_BUCKET, sprintPath, localSprintPath } from "@/lib/paths";

export const dynamic = "force-dynamic";

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

const ACTIVE_STATUSES = ["executing", "running", "provisioning"];

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sprintId: string }> },
) {
  try {
    const { user, sb } = await getUser(req);
    const { id: projectId, sprintId } = await params;

    // Load project + verify membership
    const { data: project } = await sb.from("projects").select("slug, factory_id").eq("id", projectId).single();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { data: factory } = await sb.from("factories").select("tenant_id, slug").eq("id", project.factory_id).single();
    if (!factory) return NextResponse.json({ error: "Factory not found" }, { status: 404 });

    const { data: member } = await sb.from("tenant_members").select("role").eq("tenant_id", factory.tenant_id).eq("user_id", user.id).single();
    if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Load sprint
    const { data: sprint } = await sb.from("sprints").select("id, sprint_num, status, config").eq("id", sprintId).eq("project_id", projectId).single();
    if (!sprint) return NextResponse.json({ error: "Sprint not found" }, { status: 404 });

    if (ACTIVE_STATUSES.includes(sprint.status as string)) {
      return NextResponse.json({ error: `Cannot delete a sprint that is ${sprint.status}.` }, { status: 409 });
    }

    const projectSlug = project.slug as string;
    const factorySlug = factory.slug as string;
    const { data: tenant } = await sb.from("tenants").select("slug").eq("id", factory.tenant_id).single();
    const tenantSlug = tenant?.slug as string ?? "";
    const sprintNum = sprint.sprint_num as number;
    const config = (sprint.config ?? {}) as Record<string, unknown>;
    const localBase = config.localBasePath as string | undefined;

    // ── Clean local filesystem ─────────────────────────────────
    if (localBase && tenantSlug && factorySlug) {
      try {
        const dir = localSprintPath(localBase, tenantSlug, factorySlug, projectSlug, sprintNum);
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[sprint/delete] local cleanup failed:`, (e as Error).message);
      }
    }

    // Also try resolving localBase from tenant storage integrations
    if (!localBase) {
      const { data: storageInts } = await sb.from("tenant_integrations").select("secret_value").eq("tenant_id", factory.tenant_id).eq("service_id", "storage");
      for (const row of storageInts ?? []) {
        try {
          const cfg = JSON.parse(row.secret_value as string) as { type?: string; basePath?: string };
          if (cfg.type === "local" && cfg.basePath && tenantSlug && factorySlug) {
            const dir = localSprintPath(cfg.basePath, tenantSlug, factorySlug, projectSlug, sprintNum);
            if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
            break;
          }
        } catch { /* ignore */ }
      }
    }

    // ── Clean bucket ───────────────────────────────────────────
    try {
      const prefix = sprintPath(tenantSlug, factorySlug, projectSlug, sprintNum);
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
    } catch (e) {
      console.warn(`[sprint/delete] bucket cleanup failed:`, (e as Error).message);
    }

    // ── Cascade delete: events → runs → sprint ─────────────────
    const { data: runs } = await sb.from("agent_runs").select("id").eq("sprint_id", sprintId);
    if (runs && runs.length > 0) {
      await sb.from("agent_events").delete().in("run_id", runs.map((r) => r.id));
      await sb.from("agent_runs").delete().eq("sprint_id", sprintId);
    }
    await sb.from("sprints").delete().eq("id", sprintId);

    return NextResponse.json({ ok: true, deleted: sprintId });
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
