/**
 * POST /api/projects/[id]/run
 *
 * Creates a new sprint for the project and optionally triggers it via Trigger.dev.
 *
 * Body: { briefing?: string }
 *   briefing — optional override for this sprint (defaults to project.intake_brief)
 *
 * Trigger.dev integration:
 *   Set TRIGGER_DEV_SECRET_KEY / TRIGGER_PROD_SECRET_KEY (or legacy
 *   TRIGGER_SECRET_KEY) in .env to enable automatic run trigger.
 *   Without it, sprint is created in "queued" status and you can start via CLI:
 *     factory from-scratch "..." --slug <project-slug>
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchSprint } from "@/lib/sprint-dispatcher";

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, sb } = await getUser(req);
    const { id: projectId } = await params;
    const body = await req.json() as {
      briefing?: string;
      bypassGates?: boolean;
      provider?: string;
      model?: string;
      cliExecutionMode?: "cloud" | "local";
      contextSprintIds?: string[];
      contextCategories?: ("specs" | "docs")[];
      startFromStep?: number;
      agentInstructions?: Record<string, { text: string; override: boolean }>;
      stepRoutingOverrides?: Record<string, unknown>;
    };

    // ── Load project ──────────────────────────────────────────────────────────
    const { data: project, error: projErr } = await sb
      .from("projects")
      .select("id, name, slug, status, factory_id, pipeline, intake_brief, pipeline_id, sprint_count, mode, settings")
      .eq("id", projectId)
      .single();

    if (projErr || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // ── Verify membership ─────────────────────────────────────────────────────
    const { data: factory } = await sb
      .from("factories").select("tenant_id, slug").eq("id", project.factory_id).single();
    if (!factory) return NextResponse.json({ error: "Factory not found" }, { status: 404 });

    // Resolve tenant slug for unified path convention
    const { data: tenantRow } = await sb.from("tenants").select("slug").eq("id", factory.tenant_id).single();

    const { data: member } = await sb
      .from("tenant_members").select("role").eq("tenant_id", factory.tenant_id).eq("user_id", user.id).single();
    if (!member || !["owner", "admin"].includes(member.role as string)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Guard: active sprint blocks new sprints ──────────────────────────────
    const projectStatus = project.status as string;
    if (["executing", "running", "provisioning"].includes(projectStatus)) {
      return NextResponse.json({ error: "Project already has an active sprint running. Wait for it to complete or pause first." }, { status: 409 });
    }
    if (projectStatus === "pending_save") {
      return NextResponse.json({ error: "Sprint is pending save — push to GitHub, download, or discard before starting a new sprint." }, { status: 409 });
    }

    // ── Resolve pipeline steps ────────────────────────────────────────────────
    const steps = (project.pipeline as unknown[]) ?? [];
    if (steps.length === 0) {
      return NextResponse.json({ error: "Project has no pipeline steps. Assign a pipeline first." }, { status: 422 });
    }

    let sprintNum           = (project.sprint_count as number ?? 0) + 1;
    const briefing          = body.briefing?.trim() || (project.intake_brief as string | null) || "";
    const bypassGates       = body.bypassGates ?? false;
    const provider          = body.provider?.trim() || undefined;
    const model             = body.model?.trim() || undefined;
    const cliExecutionMode  = body.cliExecutionMode ?? undefined;
    const contextSprintIds   = body.contextSprintIds?.length ? body.contextSprintIds : undefined;
    const contextCategories  = body.contextCategories?.length ? body.contextCategories : undefined;
    const agentInstructions  = body.agentInstructions && Object.keys(body.agentInstructions).length > 0
      ? body.agentInstructions : undefined;
    const bodyStartFromStep = typeof body.startFromStep === "number" && body.startFromStep >= 1
      ? body.startFromStep : undefined;

    // ── Update project pipeline snapshot ──────────────────────────────────────
    await sb.from("projects").update({ pipeline: steps }).eq("id", projectId);

    // ── Reuse or create sprint record ────────────────────────────────────────
    // sprint_count is incremented by a DB trigger on INSERT into sprints.
    // To avoid inflating the count on every "Start" click, we reuse an
    // existing sprint that has not yet been tagged in GitHub (repo_tag IS NULL).
    const { data: activeSprint } = await sb
      .from("sprints")
      .select("id, sprint_num")
      .eq("project_id", projectId)
      .is("repo_tag", null)
      .not("status", "in", '("completed","failed","cancelled","pending_save")')
      .order("sprint_num", { ascending: false })
      .limit(1)
      .maybeSingle();

    let sprint: { id: string; sprint_num: number } | null = null;
    // When reusing an active sprint, resume from the step AFTER the last
    // completed agent run — so the init sprint-push (step 1) doesn't run again.
    let startFromStep: number | undefined;

    if (activeSprint) {
      // Reuse: reset status to "queued" and update briefing/steps
      const { data: updated, error: upErr } = await sb
        .from("sprints")
        .update({ status: "queued", briefing, steps })
        .eq("id", activeSprint.id)
        .select("id, sprint_num")
        .single();
      if (upErr || !updated) throw new Error(upErr?.message ?? "Failed to reset sprint");
      sprint = updated;
      sprintNum = sprint.sprint_num; // use the existing sprint number

      if (bodyStartFromStep !== undefined) {
        // User explicitly selected a resume step — honour it, but cap at pipeline length
        startFromStep = Math.min(bodyStartFromStep, steps.length);
      } else {
        // Auto-compute resume step: last done agent_run step + 1
        // Must filter by sprint_id so prior sprints' completed steps don't skew the result
        const { data: lastDone } = await sb
          .from("agent_runs")
          .select("step")
          .eq("project_id", projectId)
          .eq("sprint_id", activeSprint.id)
          .eq("status", "done")
          .order("step", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastDone?.step) {
          const nextStep = (lastDone.step as number) + 1;
          // Only set if there are still steps remaining. If all steps are done
          // (nextStep > steps.length), let the pipeline start fresh from step 1.
          if (nextStep <= steps.length) {
            startFromStep = nextStep;
          }
        }
      }
    } else {
      // Create new sprint — DB trigger will increment projects.sprint_count
      const base_ref = sprintNum === 1 ? "unversioned" : `sprint-${sprintNum - 1}`;
      const { data: inserted, error: sprintErr } = await sb
        .from("sprints")
        .insert({
          project_id:  projectId,
          sprint_num:  sprintNum,
          pipeline_id: project.pipeline_id ?? null,
          steps,
          status:      "queued",
          briefing,
          base_ref,
        })
        .select("id, sprint_num")
        .single();
      if (sprintErr || !inserted) throw new Error(sprintErr?.message ?? "Failed to create sprint");
      sprint = inserted;
    }

    if (!sprint) throw new Error("Sprint record unavailable");

    // ── Resolve localBasePath (project settings → tenant storage integration) ─
    const projSettings = (project.settings ?? {}) as Record<string, unknown>;
    const projCli      = (projSettings.cli_agents ?? {}) as Record<string, unknown>;
    let localBasePath  = projCli.local_base_path as string | undefined;

    if (!localBasePath) {
      const { data: storageInt } = await sb
        .from("tenant_integrations")
        .select("secret_value")
        .eq("tenant_id", factory.tenant_id)
        .eq("service_id", "storage")
        .limit(1)
        .maybeSingle();
      if (storageInt?.secret_value) {
        try {
          const cfg = JSON.parse(storageInt.secret_value as string) as { type?: string; basePath?: string };
          if (cfg.type === "local" && cfg.basePath) localBasePath = cfg.basePath;
        } catch { /* ignore */ }
      }
    }

    // ── Save sprint runtime config (for next-sprint inheritance) ─────────────
    const sprintConfig = {
      mode:              cliExecutionMode ?? "cloud",
      provider:          provider ?? undefined,
      model:             model ?? undefined,
      bypassGates,
      localBasePath:     localBasePath ?? undefined,
      stepRouting:       body.stepRoutingOverrides ?? {},
      agentInstructions: agentInstructions ?? {},
    };
    await sb.from("sprints").update({ config: sprintConfig }).eq("id", sprint.id);

    // ── Dispatch via shared helper ───────────────────────────────────────────
    const tenantSlug  = tenantRow?.slug as string | undefined;
    const factorySlugVal = factory.slug as string | undefined;

    const dispatch = await dispatchSprint({
      sb,
      projectId,
      factoryId: project.factory_id as string,
      tenantId: factory.tenant_id as string,
      projectSlug: project.slug as string,
      cliExecutionMode,
      payload: {
        signal:   briefing,
        sprintId: sprint.id,
        sprintNum,
        ...(tenantSlug ? { tenantSlug } : {}),
        ...(factorySlugVal ? { factorySlug: factorySlugVal } : {}),
        ...(startFromStep !== undefined ? { startFromStep } : {}),
        ...(bypassGates ? { bypassGates: true } : {}),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(cliExecutionMode ? { cliExecutionMode } : {}),
        ...(contextSprintIds ? { contextSprintIds } : {}),
        ...(contextCategories ? { contextCategories } : {}),
        ...(agentInstructions ? { agentInstructions } : {}),
        ...(body.stepRoutingOverrides && Object.keys(body.stepRoutingOverrides).length > 0
          ? { stepRoutingOverrides: body.stepRoutingOverrides as Record<string, { cliOverride?: { enabled: boolean; cli?: string; authMode?: string } }> }
          : {}),
      },
    });

    if (!dispatch.ok) {
      // Roll back the sprint row so sprint_count does not drift.
      await sb.from("sprints").delete().eq("id", sprint.id);
      if (!activeSprint) {
        await sb.from("projects")
          .update({ sprint_count: project.sprint_count as number ?? 0 })
          .eq("id", projectId);
      }

      if (dispatch.reason === "no-key") {
        return NextResponse.json({
          triggered:   false,
          cli_command: `factory from-scratch "${briefing.slice(0, 80)}" --slug ${project.slug as string}`,
        }, { status: 200 });
      }

      if (dispatch.reason === "no-slot") {
        return NextResponse.json(
          { error: "Factory is at its concurrent project limit. Raise max_concurrent_projects or wait for a running sprint to finish." },
          { status: 429, headers: { "Retry-After": "30" } },
        );
      }

      if (dispatch.reason === "project-busy") {
        return NextResponse.json({ error: "Project already has a sprint running. Wait for it to complete or pause first." }, { status: 409 });
      }

      if (dispatch.reason === "trigger-rejected") {
        return NextResponse.json(
          { error: `Trigger.dev rejected the run: ${dispatch.detail ?? ""}` },
          { status: 502 },
        );
      }

      return NextResponse.json(
        { error: dispatch.detail ?? `Dispatch failed: ${dispatch.reason}` },
        { status: 500 },
      );
    }

    if (dispatch.triggerRunId) {
      await sb.from("sprints")
        .update({ trigger_run_id: dispatch.triggerRunId, status: "running" })
        .eq("id", sprint.id);
    }

    return NextResponse.json({
      sprint,
      trigger_run_id: dispatch.triggerRunId,
      triggered:      true,
    }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
