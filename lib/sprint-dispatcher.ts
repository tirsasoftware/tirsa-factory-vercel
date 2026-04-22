import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveTriggerKey,
  type TriggerExecutionMode,
} from "@/lib/trigger-key-resolver";

const TRIGGER_API = "https://api.trigger.dev";
const TRIGGER_TASK_ID = "run-pipeline";

export type DispatchSprintInput = {
  sb: SupabaseClient;
  projectId: string;
  factoryId: string;
  tenantId: string;
  projectSlug: string;
  /** Merged verbatim into the Trigger.dev `payload` along with projectId/projectSlug. */
  payload: Record<string, unknown>;
  cliExecutionMode?: TriggerExecutionMode;
  /** Final project.status after a successful Trigger.dev dispatch. Defaults to "executing". */
  runningStatus?: "executing";
};

export type DispatchSprintResult =
  | {
      ok: true;
      triggerRunId: string | null;
      priorStatus: string | null;
    }
  | {
      ok: false;
      reason:
        | "no-key"
        | "no-slot"
        | "project-not-found"
        | "factory-mismatch"
        | "project-busy"
        | "trigger-rejected"
        | "trigger-error";
      detail?: string;
      priorStatus?: string | null;
    };

/**
 * Unified sprint dispatcher.
 *
 * Encapsulates the sequence shared by POST /run, /approve, and /continue:
 *   1. Resolve the per-tenant Trigger.dev secret (dev vs prod).
 *   2. Atomically reserve a concurrency slot in the factory (setting
 *      project.status to "provisioning").
 *   3. POST the pipeline run to Trigger.dev.
 *   4. On success, mark project.status = "executing".
 *   5. On failure, revert project.status to its prior value so the slot is
 *      released.
 *
 * Does not mutate the sprint row — callers own sprint lifecycle.
 */
export async function dispatchSprint(
  input: DispatchSprintInput,
): Promise<DispatchSprintResult> {
  const {
    sb,
    projectId,
    factoryId,
    tenantId,
    projectSlug,
    payload,
    cliExecutionMode,
    runningStatus = "executing",
  } = input;

  const triggerKey = await resolveTriggerKey(sb, tenantId, cliExecutionMode);
  if (!triggerKey) {
    return { ok: false, reason: "no-key" };
  }

  // Atomic slot acquire — sets project.status = "provisioning".
  const { data: slotRows, error: slotErr } = await sb.rpc(
    "try_acquire_factory_slot",
    {
      p_factory_id: factoryId,
      p_project_id: projectId,
      p_target_status: "provisioning",
    },
  );

  if (slotErr) {
    return {
      ok: false,
      reason: "trigger-error",
      detail: `Slot acquire failed: ${slotErr.message}`,
    };
  }

  type SlotRow = { acquired: boolean; reason: string | null; prior_status: string | null };
  const slot = (Array.isArray(slotRows) ? slotRows[0] : slotRows) as SlotRow | null;
  if (!slot || slot.acquired !== true) {
    const rawReason = slot?.reason ?? "no-slot";
    const reason =
      rawReason === "project-not-found" ||
      rawReason === "factory-mismatch" ||
      rawReason === "project-busy"
        ? rawReason
        : "no-slot";
    return {
      ok: false,
      reason,
      priorStatus: slot?.prior_status ?? null,
    };
  }

  const priorStatus = (slot.prior_status as string | null) ?? null;

  try {
    const triggerRes = await fetch(
      `${TRIGGER_API}/api/v1/tasks/${TRIGGER_TASK_ID}/trigger`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${triggerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: {
            projectId,
            projectSlug,
            ...payload,
          },
        }),
      },
    );

    if (!triggerRes.ok) {
      const detail = await triggerRes.text();
      await releaseSlot(sb, projectId, priorStatus);
      return { ok: false, reason: "trigger-rejected", detail, priorStatus };
    }

    const triggerBody = (await triggerRes.json()) as { id?: string };
    const triggerRunId = triggerBody.id ?? null;

    if (triggerRunId) {
      await sb.from("projects")
        .update({ status: runningStatus })
        .eq("id", projectId);
    } else {
      await releaseSlot(sb, projectId, priorStatus);
    }

    return { ok: true, triggerRunId, priorStatus };
  } catch (e) {
    await releaseSlot(sb, projectId, priorStatus);
    return {
      ok: false,
      reason: "trigger-error",
      detail: (e as Error).message,
      priorStatus,
    };
  }
}

async function releaseSlot(
  sb: SupabaseClient,
  projectId: string,
  priorStatus: string | null,
): Promise<void> {
  await sb.from("projects")
    .update({ status: priorStatus ?? "paused" })
    .eq("id", projectId);
}
