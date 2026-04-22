"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { brand } from "@/lib/brand";
import type { Project, AgentRun } from "@/lib/types";
import type { Session } from "@supabase/supabase-js";
import InfraMonitor from "@/components/InfraMonitor";
import AgentCatalog from "@/components/AgentCatalog";
// SipocCanvas removed — SIPOC contracts live in pipelines now
import AppSidebar from "@/components/AppSidebar";
import ProjectCanvas from "@/components/ProjectCanvas";
import { SprintRow, type Sprint as SharedSprint } from "@/components/ProjectCard";
import {
  LayoutDashboard, Server, Users, Workflow,
  Plus, Play, SkipForward, X, Zap, Clock, FolderOpen, Cloud,
  AlertTriangle, Loader2, RefreshCw, GitBranch, RotateCcw,
  Pause, ChevronDown, ChevronRight, CheckCircle2, Circle, XCircle,
  Download, Trash2, FileText, ExternalLink, Pencil, HelpCircle,
} from "lucide-react";

/* ─── Local DB type (supabase returns more fields than the shared type) ─── */
type DBProject = Project & {
  sprint_count?: number;
  intake_brief?: string | null;
  last_error?: string | null;
  mode?: string;
};

/* ─── Provider catalogue for StartSprintModal ───────── */
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google",
  mistral: "Mistral", perplexity: "Perplexity", xai: "xAI",
  deepseek: "DeepSeek", qwen: "Qwen",
};
interface LiveProvider { id: string; models: { id: string; name: string }[] }

/* ─── Queue status sets ─────────────────────────────── */
const QUEUE_STATUSES = new Set(["queued", "executing", "running", "waiting", "paused", "provisioning", "pending_save"]);

/* ─── Views ──────────────────────────────────────────── */
type View = "queue" | "squads" | "infra";

const NAV_ITEMS: { id: View; icon: React.FC<{ size?: number }>; label: string }[] = [
  { id: "queue",  icon: LayoutDashboard, label: "Office" },
  { id: "squads", icon: Users,           label: "Squads" },
  // SIPOC Map removed
  { id: "infra",  icon: Server,          label: "Infrastructure" },
];

/* ─── Responsive hook ────────────────────────────────── */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

/* ─── Status helpers ─────────────────────────────────── */
const STATUS_COLOR: Record<string, string> = {
  provisioning: "#6b7a9e", ready: "#10b981", executing: "#1463ff",
  waiting: "#f59f00", completed: "#00c2a8", paused: "#f59f00",
  cancelled: "#6b7a9e", failed: "#e44b5f", queued: "#6b7a9e", running: "#1463ff",
  pending_save: "#f59f00",
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#6b7a9e";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
      padding: "2px 8px", borderRadius: 99,
      background: `${color}18`, color,
    }}>
      {status}
    </span>
  );
}

/* ─── Main ───────────────────────────────────────────── */
export default function Home() {
  const router = useRouter();
  const { session, factoryId, loading: authLoading, factories } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("queue");
  const [runsMap, setRunsMap] = useState<Map<string, AgentRun[]>>(new Map());
  const isMobile = useIsMobile();
  // Tracks IDs of projects belonging to this factory — used to scope Realtime callbacks.
  const projectIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!authLoading && !session) {
      if (brand.urls.landing) window.location.href = brand.urls.landing;
      else router.replace("/login");
    }
  }, [authLoading, session, router]);

  // Redirect to factory settings if user has no factories
  useEffect(() => {
    if (!authLoading && session && (!factoryId || factories.length === 0)) {
      router.replace("/factory-settings");
    }
  }, [authLoading, session, factories, router]);

  useEffect(() => {
    if (!authLoading && !factoryId && session) setLoading(false);
  }, [authLoading, factoryId, session]);

  useEffect(() => {
    if (!factoryId) return;
    async function fetchProjects() {
      const { data } = await supabase
        .from("projects")
        .select("*")
        .eq("factory_id", factoryId)
        .order("created_at", { ascending: false });
      if (data) {
        setProjects(data);
        projectIdsRef.current = new Set(data.map((p: Project) => p.id));
      }
      setLoading(false);
    }
    fetchProjects();

    const channel = supabase
      .channel(`projects-list:${factoryId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `factory_id=eq.${factoryId}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          const p = payload.new as Project;
          projectIdsRef.current.add(p.id);
          setProjects((prev) => [p, ...prev]);
        } else if (payload.eventType === "UPDATE") {
          setProjects((prev) =>
            prev.map((p) => p.id === (payload.new as Project).id ? (payload.new as Project) : p)
          );
        }
      })
      .subscribe();
    return () => { channel.unsubscribe().then(() => supabase.removeChannel(channel)); };
  }, [factoryId]);

  useEffect(() => {
    if (!factoryId) return;

    async function fetchAllRuns() {
      // Join !inner so only runs whose project belongs to this factory are returned.
      const { data } = await supabase
        .from("agent_runs")
        .select("*, projects!inner(factory_id)")
        .eq("projects.factory_id", factoryId)
        .order("step", { ascending: true });
      if (!data) return;
      const map = new Map<string, AgentRun[]>();
      for (const { projects: _projects, ...r } of data as (AgentRun & { projects: unknown })[]) {
        const arr = map.get(r.project_id) ?? [];
        arr.push(r as AgentRun);
        map.set(r.project_id, arr);
      }
      setRunsMap(map);
    }
    fetchAllRuns();

    const channel = supabase
      .channel(`all-runs:${factoryId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_runs" }, (payload) => {
        const run = payload.new as AgentRun;
        // Only process runs that belong to this factory's projects.
        if (!projectIdsRef.current.has(run.project_id)) return;
        setRunsMap((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(run.project_id) ?? [])];
          if (payload.eventType === "INSERT") {
            arr.push(run);
          } else if (payload.eventType === "UPDATE") {
            const idx = arr.findIndex((r) => r.id === run.id);
            if (idx >= 0) arr[idx] = run; else arr.push(run);
          }
          next.set(run.project_id, arr);
          return next;
        });
      })
      .subscribe();
    return () => { channel.unsubscribe().then(() => supabase.removeChannel(channel)); };
  }, [factoryId]);

  function updateProject(p: Project) {
    setProjects((prev) => prev.map((x) => x.id === p.id ? p : x));
  }

  if (authLoading) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--base)" }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--surface1)", borderTopColor: "var(--blue)", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (!session) return null;

  return (
    <div style={{
      display: "flex", height: "100vh",
      fontFamily: "var(--font-sans)",
      background: "linear-gradient(180deg, var(--base) 0%, var(--mantle) 100%)",
      color: "var(--text)",
    }}>
      <AppSidebar active="command-center" />

      <div className="main-content" style={{
        width: isMobile ? "100vw" : "calc(100vw - 240px)",
        height: "100%",
        overflow: "hidden",
      }}>
        {view === "queue" && (
          <QueueView
            projects={projects}
            loading={loading}
            runsMap={runsMap}
            session={session}
            onProjectUpdate={updateProject}
          />
        )}
        {view === "squads" && <SquadsView />}
        {/* SIPOC canvas removed — SIPOC contracts now live in pipelines */}
        {view === "infra" && (
          <div style={{ padding: 24, overflowY: "auto", height: "100%" }}>
            <div style={{ maxWidth: 900, margin: "0 auto" }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 16px 0" }}>Infrastructure</h2>
              <InfraMonitor />
            </div>
          </div>
        )}
      </div>

      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => {
          const active = view === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 4,
                background: "none", border: "none", cursor: "pointer",
                color: active ? "var(--blue)" : "var(--overlay1)",
                padding: "8px 0",
                transition: "color 0.15s ease",
              }}
            >
              <Icon size={20} />
              <span style={{ fontSize: 9, fontWeight: active ? 600 : 400, letterSpacing: "0.3px" }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ─── Squads View ─────────────────────────────────────── */
function SquadsView() {
  return (
    <div style={{ padding: "32px 40px", overflowY: "auto", height: "100%" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "0 0 4px 0" }}>Squads</h2>
        <p style={{ fontSize: 13, color: "var(--subtext0)", margin: "0 0 28px 0" }}>
          All 38 factory agents organized by squad.
        </p>
        <AgentCatalog />
      </div>
    </div>
  );
}

/* ─── Queue View ─────────────────────────────────────── */
type ActionState = { loading: boolean; msg?: { type: "error" | "cli"; text: string } };

/** Collapsed card for a completed sprint — shows project name, sprint count, repo link, and a re-queue button */
function CompletedProjectCard({ project, db, onRequeue }: {
  project: Project;
  db: DBProject;
  onRequeue: () => void;
}) {
  const repoUrl = (project as { repo_url?: string | null }).repo_url;

  return (
    <div style={{ borderRadius: 10, background: "var(--surface0)", border: "1px solid var(--surface1)", overflow: "hidden", marginBottom: 8 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <code style={{ fontSize: 10, color: "var(--overlay0)" }}>{project.slug}</code>
            {db.sprint_count !== undefined && db.sprint_count > 0 && (
              <span style={{ fontSize: 10, color: "var(--overlay0)", display: "flex", alignItems: "center", gap: 3 }}>
                <GitBranch size={9} /> {db.sprint_count} sprint{db.sprint_count !== 1 ? "s" : ""}
              </span>
            )}
            <span style={{ fontSize: 10, color: "var(--blue, #1463ff)", fontWeight: 500 }}>
              next: sprint {(db.sprint_count ?? 0) + 1}
            </span>
            {repoUrl && (
              <a href={repoUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 10, color: "var(--blue)", textDecoration: "none" }}>
                {repoUrl.replace("https://github.com/", "")}
              </a>
            )}
          </div>
        </div>

        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "rgba(64,160,43,0.12)", color: "var(--green, #40a02b)", fontWeight: 600 }}>
          completed
        </span>

        <button
          onClick={onRequeue}
          title="Re-add to pipeline for a new sprint"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: 6, border: "1px solid var(--surface2)",
            background: "none", cursor: "pointer", color: "var(--subtext0)",
            fontSize: 11, fontFamily: "var(--font-sans)",
          }}
        >
          <RefreshCw size={10} /> New sprint
        </button>
      </div>
    </div>
  );
}

/** Running/paused project card: QueueRow header + collapsible ProjectCanvas */
function RunningProjectCard({ project, db, sprintInfoMap, actions, runsMap, onPause, onRemove, session, onPlay, onSprintModal, onMarkCompleted }: {
  project: Project;
  db: DBProject;
  sprintInfoMap: Map<string, SprintInfo>;
  actions: Record<string, ActionState>;
  runsMap: Map<string, AgentRun[]>;
  onPause: () => void;
  onRemove: () => void;
  session: Session;
  onPlay?: () => void;
  onSprintModal?: () => void;
  onMarkCompleted?: () => void;
}) {
  const isPaused = ["paused", "waiting"].includes(project.status as string);
  const [canvasOpen, setCanvasOpen] = useState(!isPaused);
  const sprintInfo = sprintInfoMap.get(project.id);

  // Only show runs that belong to the current sprint (created after the sprint started).
  // This prevents stale runs from a previous sprint polluting the Agent Pipeline view.
  const allRuns = runsMap.get(project.id) ?? [];
  const runs = sprintInfo?.created_at
    ? allRuns.filter((r) => r.created_at >= sprintInfo.created_at)
    : allRuns;

  return (
    <div>
      <QueueRow
        project={project}
        sprintCount={db.sprint_count}
        activeSprintNum={sprintInfo?.sprint_num}
        brief={db.intake_brief}
        lastError={db.last_error}
        state={actions[project.id]}
        status={project.status as string}
        canStart={isPaused}
        runs={runs}
        onPause={onPause}
        onRemove={onRemove}
        {...(onPlay ? { onPlay } : {})}
        {...(onSprintModal ? { onSprintModal } : {})}
        {...(onMarkCompleted ? { onMarkCompleted } : {})}
      />

      {/* Agent Pipeline — collapsible, scoped to current sprint */}
      <div style={{ marginTop: 8, borderRadius: 10, border: "1px solid rgba(20,99,255,0.15)", overflow: "hidden" }}>
        <button
          onClick={() => setCanvasOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            width: "100%", padding: "8px 14px",
            background: "var(--surface0)", border: "none", cursor: "pointer",
            color: "var(--subtext0)", fontSize: 11, fontFamily: "var(--font-sans)",
            borderBottom: canvasOpen ? "1px solid rgba(20,99,255,0.12)" : "none",
          }}
        >
          {canvasOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Agent Pipeline
          {sprintInfo && (
            <span style={{ fontSize: 10, color: "var(--overlay0)", marginLeft: 4 }}>
              · sprint {sprintInfo.sprint_num}
            </span>
          )}
          {sprintInfo?.briefing && (
            <span style={{ fontSize: 10, color: "var(--overlay0)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 2 }}>
              — {sprintInfo.briefing.slice(0, 60)}{sprintInfo.briefing.length > 60 ? "…" : ""}
            </span>
          )}
        </button>

        {canvasOpen && (
          <div style={{ background: "var(--surface0)" }}>
            {/* Initializing banner — shown when no agent_runs exist yet for this sprint */}
            {runs.length === 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 20px", borderBottom: "1px solid rgba(20,99,255,0.1)",
                background: "rgba(20,99,255,0.04)",
              }}>
                <Loader2 size={14} color="#1463ff" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                    Initializing pipeline…
                  </div>
                  {sprintInfo?.briefing && (
                    <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sprintInfo.briefing}
                    </div>
                  )}
                </div>
                {sprintInfo?.trigger_run_id && (
                  <a
                    href={`https://cloud.trigger.dev/runs/${sprintInfo.trigger_run_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 10, color: "var(--blue)", textDecoration: "none", flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}
                  >
                    Trigger.dev run ↗
                  </a>
                )}
              </div>
            )}
            <div style={{ padding: "16px 20px" }}>
              <ProjectCanvas
                projectId={project.id}
                projectName={project.name}
                projectSlug={(project as DBProject).slug}
                projectStatus={project.status as string}
                projectPhase={(project as { phase?: string }).phase ?? "validate"}
                projectRepoUrl={(project as { repo_url?: string | null }).repo_url}
                projectBaseRef={(project as { base_ref?: string }).base_ref}
                pipeline={(project.pipeline ?? []) as { step: number; agent: string; gate: string | null }[]}
                externalRuns={runs}
                sprintNum={sprintInfo?.sprint_num}
                sprintBriefing={sprintInfo?.briefing ?? undefined}
                triggerRunId={sprintInfo?.trigger_run_id ?? undefined}
                executionBackend={((project as DBProject).settings?.cli_agents as { execution_backend?: "supabase" | "local" } | undefined)?.execution_backend}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sprint History — collapsed by default */}
      <SprintHistoryPanel projectId={project.id} session={session} runsMap={runsMap} currentSprintInfo={sprintInfo} sprintCount={db.sprint_count} />
    </div>
  );
}

function QueueView({
  projects, loading, runsMap, session, onProjectUpdate,
}: {
  projects: Project[];
  loading: boolean;
  runsMap: Map<string, AgentRun[]>;
  session: Session;
  onProjectUpdate: (p: Project) => void;
}) {
  const { factoryId, factories } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [sprintModal, setSprintModal] = useState<DBProject | null>(null);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  // Maps project_id → { sprint_num, created_at } of the currently active (non-tagged) sprint
  const [sprintInfoMap, setSprintInfoMap] = useState<Map<string, SprintInfo>>(new Map());
  const sprintDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const projectIds = projects.map((p) => p.id);

    async function fetchActiveSprints() {
      const query = supabase
        .from("sprints")
        .select("project_id, sprint_num, created_at, trigger_run_id, briefing")
        .is("repo_tag", null)
        .not("status", "in", '("completed","failed","cancelled")');
      // Scope to this factory's projects when we have them.
      const { data } = projectIds.length > 0
        ? await query.in("project_id", projectIds)
        : await query;
      if (!data) return;
      const map = new Map<string, SprintInfo>();
      for (const s of data as { project_id: string; sprint_num: number; created_at: string; trigger_run_id: string | null; briefing: string | null }[]) {
        // If multiple active sprints exist (edge case), keep the highest sprint_num
        const existing = map.get(s.project_id);
        if (existing === undefined || s.sprint_num > existing.sprint_num) {
          map.set(s.project_id, { sprint_num: s.sprint_num, created_at: s.created_at, trigger_run_id: s.trigger_run_id, briefing: s.briefing });
        }
      }
      setSprintInfoMap(map);
    }
    fetchActiveSprints();

    const channel = supabase
      .channel("active-sprints")
      .on("postgres_changes", { event: "*", schema: "public", table: "sprints" }, () => {
        // Debounce: rapid sprint changes (e.g. bulk updates) collapse into a single fetch.
        if (sprintDebounceRef.current) clearTimeout(sprintDebounceRef.current);
        sprintDebounceRef.current = setTimeout(fetchActiveSprints, 400);
      })
      .subscribe();
    return () => {
      if (sprintDebounceRef.current) clearTimeout(sprintDebounceRef.current);
      channel.unsubscribe().then(() => supabase.removeChannel(channel));
    };
  }, [projects]);

  const inQueue   = projects.filter((p) => QUEUE_STATUSES.has(p.status as string));
  const completed = projects.filter((p) => (p.status as string) === "completed");
  const notQueue  = projects.filter((p) => !QUEUE_STATUSES.has(p.status as string) && (p.status as string) !== "completed");
  const running      = inQueue.filter((p) => ["executing", "running", "provisioning"].includes(p.status as string));
  const queued       = inQueue.filter((p) => (p.status as string) === "queued");
  const paused       = inQueue.filter((p) => ["paused", "waiting"].includes(p.status as string));
  const pendingSave  = inQueue.filter((p) => (p.status as string) === "pending_save");

  const activeFactory = factories.find((f) => f.id === factoryId) ?? null;
  const maxConcurrent = (() => {
    const raw = Number((activeFactory?.config as Record<string, unknown> | null | undefined)?.max_concurrent_projects);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  })();
  const atCapacity = running.length >= maxConcurrent;

  function setAction(id: string, state: ActionState) {
    setActions((prev) => ({ ...prev, [id]: state }));
  }

  async function addToQueue(project: Project) {
    setAction(project.id, { loading: true });
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "queued" }),
    });
    if (res.ok) {
      onProjectUpdate({ ...project, status: "queued" as Project["status"] });
      setShowAdd(false);
    } else {
      const body = await res.json() as { error?: string };
      setAction(project.id, { loading: false, msg: { type: "error", text: body.error ?? "Failed." } });
    }
    setActions((prev) => { const next = { ...prev }; delete next[project.id]; return next; });
  }

  async function removeFromQueue(project: Project) {
    setAction(project.id, { loading: true });
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ready" }),
    });
    if (res.ok) {
      onProjectUpdate({ ...project, status: "ready" as Project["status"] });
    } else {
      const body = await res.json() as { error?: string };
      setAction(project.id, { loading: false, msg: { type: "error", text: body.error ?? "Failed." } });
    }
    setActions((prev) => { const next = { ...prev }; delete next[project.id]; return next; });
  }

  async function markAsCompleted(project: Project) {
    setAction(project.id, { loading: true });
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    if (res.ok) {
      onProjectUpdate({ ...project, status: "completed" as Project["status"] });
    } else {
      const body = await res.json() as { error?: string };
      setAction(project.id, { loading: false, msg: { type: "error", text: body.error ?? "Failed." } });
    }
    setActions((prev) => { const next = { ...prev }; delete next[project.id]; return next; });
  }

  async function startProject(project: Project) {
    if (atCapacity) return; // respect factories.config.max_concurrent_projects
    setAction(project.id, { loading: true });
    const res = await fetch(`/api/projects/${project.id}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json() as { triggered?: boolean; cli_command?: string | null; error?: string };
    if (res.status === 429) {
      setAction(project.id, { loading: false, msg: { type: "error", text: "Factory is at its concurrent project limit. Wait for a running sprint to finish, or raise Max concurrent projects in Factory Settings." } });
      return;
    }
    if (!res.ok) {
      setAction(project.id, { loading: false, msg: { type: "error", text: body.error ?? "Start failed." } });
      return;
    }
    if (body.cli_command) {
      setAction(project.id, { loading: false, msg: { type: "cli", text: body.cli_command } });
      return;
    }
    if (body.triggered) {
      onProjectUpdate({ ...project, status: "executing" as Project["status"] });
    } else {
      setAction(project.id, { loading: false, msg: { type: "error", text: "Trigger.dev not configured. Check Integrations → Platforms." } });
      return;
    }
    setActions((prev) => { const next = { ...prev }; delete next[project.id]; return next; });
  }

  async function resumeProject(project: Project) {
    setAction(project.id, { loading: true });
    // Resolve execution mode from project settings to use the correct trigger key
    const db = project as DBProject;
    const cliCfg = db.settings?.cli_agents as { execution_mode?: "cloud" | "local" } | undefined;
    const cliExecutionMode = cliCfg?.execution_mode ?? "local";
    const res = await fetch(`/api/projects/${project.id}/continue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cliExecutionMode }),
    });
    const body = await res.json() as { triggered?: boolean; cli_command?: string | null; error?: string };
    if (res.status === 429) {
      setAction(project.id, { loading: false, msg: { type: "error", text: "Factory is at its concurrent project limit. Wait for a running sprint to finish, or raise Max concurrent projects in Factory Settings." } });
      return;
    }
    if (!res.ok) {
      setAction(project.id, { loading: false, msg: { type: "error", text: body.error ?? "Resume failed." } });
      return;
    }
    if (body.cli_command) {
      setAction(project.id, { loading: false, msg: { type: "cli", text: body.cli_command } });
      return;
    }
    if (body.triggered) {
      onProjectUpdate({ ...project, status: "executing" as Project["status"] });
    } else {
      setAction(project.id, { loading: false, msg: { type: "error", text: "Trigger.dev not configured. Check Integrations → Platforms." } });
      return;
    }
    setActions((prev) => { const next = { ...prev }; delete next[project.id]; return next; });
  }

  async function pauseProject(project: Project) {
    setAction(project.id, { loading: true });
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    if (res.ok) {
      onProjectUpdate({ ...project, status: "paused" as Project["status"] });
    } else {
      const body = await res.json() as { error?: string };
      setAction(project.id, { loading: false, msg: { type: "error", text: body.error ?? "Pause failed." } });
    }
    setActions((prev) => { const next = { ...prev }; delete next[project.id]; return next; });
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--surface1)", borderTopColor: "var(--blue)", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        padding: "18px 24px", borderBottom: "1px solid var(--surface0)",
        background: "var(--mantle)", display: "flex", alignItems: "center", gap: 14, flexShrink: 0,
      }}>
        <LayoutDashboard size={20} color="var(--blue)" />
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Office</h1>
          <p style={{ fontSize: 12, color: "var(--subtext0)", margin: 0, marginTop: 2 }}>
            {inQueue.length === 0
              ? "No projects in the pipeline"
              : `${running.length}/${maxConcurrent} running · ${queued.length} queued · ${paused.length} paused`}
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowAdd(true)}
          disabled={notQueue.length === 0}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 16px", borderRadius: 9, border: "none",
            background: notQueue.length === 0 ? "var(--surface1)" : "#1463ff",
            color: notQueue.length === 0 ? "var(--overlay0)" : "#fff",
            fontSize: 13, fontWeight: 700, cursor: notQueue.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
          }}
        >
          <Plus size={14} /> Add to queue
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>

          {inQueue.length === 0 && (
            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 16, padding: "60px 32px", textAlign: "center",
            }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--surface0)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FolderOpen size={28} color="var(--overlay1)" />
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Office is empty</div>
                <div style={{ fontSize: 13, color: "var(--subtext0)", maxWidth: 340, lineHeight: 1.5 }}>
                  {notQueue.length === 0
                    ? "Create projects first, then add them to the Office queue."
                    : "Add a project to the queue to start running your pipeline."}
                </div>
              </div>
              {notQueue.length > 0 && (
                <button
                  onClick={() => setShowAdd(true)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, border: "none", background: "#1463ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}
                >
                  <Plus size={14} /> Add to queue
                </button>
              )}
            </div>
          )}

          {/* Running */}
          {running.length > 0 && (
            <QueueSection
              label="Running"
              indicator={<Zap size={13} color="#1463ff" />}
              count={running.length}
            >
              {running.map((project) => {
                const db = project as DBProject;
                return (
                  <RunningProjectCard
                    key={project.id}
                    project={project}
                    db={db}
                    sprintInfoMap={sprintInfoMap}
                    actions={actions}
                    runsMap={runsMap}
                    session={session}
                    onPause={() => pauseProject(project)}
                    onRemove={() => removeFromQueue(project)}
                  />
                );
              })}
            </QueueSection>
          )}

          {/* Queued */}
          {queued.length > 0 && (
            <QueueSection
              label="Queued Projects"
              indicator={<Clock size={13} color="var(--overlay0)" />}
              count={queued.length}
            >
              {queued.map((project, i) => {
                const db = project as DBProject;
                return (
                  <QueueRow
                    key={project.id}
                    project={project}
                    index={i + 1}
                    sprintCount={db.sprint_count}
                    activeSprintNum={sprintInfoMap.get(project.id)?.sprint_num}
                    brief={db.intake_brief}
                    state={actions[project.id]}
                    status={project.status as string}
                    canStart={!atCapacity}
                    blockedReason={atCapacity ? `Factory at capacity (${running.length}/${maxConcurrent})` : undefined}
                    onPlay={() => setSprintModal(db)}
                    onSprintModal={() => setSprintModal(db)}
                    onRemove={() => removeFromQueue(project)}
                  />
                );
              })}
            </QueueSection>
          )}

          {/* Paused */}
          {paused.length > 0 && (
            <QueueSection
              label="Paused"
              indicator={<Clock size={13} color="#f59f00" />}
              count={paused.length}
            >
              {paused.map((project) => {
                const db = project as DBProject;
                return (
                  <RunningProjectCard
                    key={project.id}
                    project={project}
                    db={db}
                    sprintInfoMap={sprintInfoMap}
                    actions={actions}
                    runsMap={runsMap}
                    onPause={() => pauseProject(project)}
                    onRemove={() => removeFromQueue(project)}
                    onPlay={() => resumeProject(project)}
                    onSprintModal={() => setSprintModal(db)}
                    onMarkCompleted={() => markAsCompleted(project)}
                    session={session!}
                  />
                );
              })}
            </QueueSection>
          )}

          {/* Pending Save */}
          {pendingSave.length > 0 && (
            <QueueSection
              label="Pending Save"
              indicator={<Download size={13} color="#f59f00" />}
              count={pendingSave.length}
            >
              {pendingSave.map((project) => {
                const db = project as DBProject;
                return (
                  <PendingSaveCard
                    key={project.id}
                    project={project}
                    db={db}
                    sprintInfoMap={sprintInfoMap}
                    runsMap={runsMap}
                    session={session}
                    onSaved={(p) => onProjectUpdate(p)}
                  />
                );
              })}
            </QueueSection>
          )}

          {/* Completed Sprints */}
          {completed.length > 0 && (
            <QueueSection
              label="Completed Sprints"
              indicator={<CheckCircle2 size={13} color="var(--green, #40a02b)" />}
              count={completed.length}
            >
              {completed.map((project) => {
                const db = project as DBProject;
                return (
                  <CompletedProjectCard
                    key={project.id}
                    project={project}
                    db={db}
                    onRequeue={() => addToQueue(project)}
                  />
                );
              })}
            </QueueSection>
          )}
        </div>
      </div>

      {/* Add to queue modal */}
      {showAdd && (
        <AddToQueueModal
          projects={notQueue}
          actionStates={actions}
          onAdd={addToQueue}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Start Sprint modal */}
      {sprintModal && (
        <StartSprintModal
          project={sprintModal}
          session={session}
          runsMap={runsMap}
          onClose={() => setSprintModal(null)}
          onStarted={(p) => { onProjectUpdate(p); setSprintModal(null); }}
        />
      )}
    </div>
  );
}

/* ─── PendingSaveCard ───────────────────────────────── */

type PendingSaveAction = "idle" | "done" | "error";
type LoadingAction = "export" | "discard" | "close" | null;

function PendingSaveCard({ project, db, sprintInfoMap, runsMap, session, onSaved }: {
  project: Project;
  db: DBProject;
  sprintInfoMap: Map<string, SprintInfo>;
  runsMap: Map<string, AgentRun[]>;
  session: Session;
  onSaved: (p: Project) => void;
}) {
  const { tenantId: authTenantId } = useAuth();
  const cliSettings = ((db.settings as Record<string, unknown> | null)?.cli_agents as Record<string, unknown> | undefined) ?? {};
  const storageType = (cliSettings.execution_backend as "supabase" | "local" | undefined) ?? "supabase";
  const sprintInfo = sprintInfoMap.get(project.id);
  const sprintNum  = sprintInfo?.sprint_num ?? db.sprint_count ?? 1;
  const [state, setState] = useState<PendingSaveAction>("idle");
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter runs to current sprint (by start time), same logic as RunningProjectCard
  const allRuns = runsMap.get(project.id) ?? [];
  const runs = sprintInfo?.created_at
    ? allRuns.filter((r) => r.created_at >= sprintInfo.created_at)
    : allRuns;

  const [pipelineOpen, setPipelineOpen] = useState(true);

  // We need the sprint ID to call the save API — fetch it once
  const [sprintId, setSprintId] = useState<string | null>(null);
  useEffect(() => {
    supabase
      .from("sprints")
      .select("id")
      .eq("project_id", project.id)
      .eq("status", "pending_save")
      .order("sprint_num", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setSprintId(data.id as string); });
  }, [project.id]);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportTargets, setExportTargets] = useState<Set<string>>(new Set());
  const [availableTargets, setAvailableTargets] = useState<{ id: string; label: string; available: boolean }[]>([
    { id: "github", label: "Push to GitHub", available: false },
    { id: "download", label: "Download ZIP", available: true },
  ]);

  // Check which export targets are available (GitHub configured?)
  useEffect(() => {
    if (!session || !authTenantId) return;
    fetch(`/api/settings/integrations?tenantId=${authTenantId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (res) => {
        if (!res.ok) return;
        const { configured } = await res.json() as { configured: string[] };
        const ghConfigured = configured.some((c: string) => c.includes("GITHUB_TOKEN"));
        setAvailableTargets((prev) => prev.map((t) =>
          t.id === "github" ? { ...t, available: ghConfigured } : t
        ));
      })
      .catch(() => {});
  }, [session, authTenantId]);

  async function actExport() {
    if (!sprintId || exportTargets.size === 0) return;
    setLoadingAction("export"); setErrorMsg(null);
    try {
      const targets = Array.from(exportTargets);
      const res = await fetch(`/api/projects/${project.id}/sprints/${sprintId}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export", targets }),
      });

      // If download is a target and response is a zip, stream it
      if (targets.includes("download") && res.headers.get("content-type")?.includes("application/zip")) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url;
        a.download = `${project.slug}-sprint-${sprintNum}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        setLoadingAction(null); setState("done"); setExportOpen(false);
        onSaved({ ...project, status: "completed" as Project["status"] });
        return;
      }

      const body = await res.json() as { ok?: boolean; error?: string; results?: { target: string; ok: boolean; error?: string }[] };
      if (!res.ok) { setErrorMsg(body.error ?? `Export failed (${res.status})`); setLoadingAction(null); setState("error"); return; }

      setLoadingAction(null); setState("done"); setExportOpen(false);
      onSaved({ ...project, status: "completed" as Project["status"] });
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Network error");
      setLoadingAction(null); setState("error");
    }
  }

  async function actSimple(action: "discard" | "close") {
    if (!sprintId) { setErrorMsg("Sprint ID not loaded yet — try again."); return; }
    setLoadingAction(action); setErrorMsg(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/sprints/${sprintId}/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setErrorMsg(body.error ?? `Action failed (${res.status})`); setLoadingAction(null); setState("error"); return; }
      setLoadingAction(null); setState("done");
      onSaved({ ...project, status: "completed" as Project["status"] });
    } catch (e) {
      setErrorMsg((e as Error).message ?? "Network error");
      setLoadingAction(null); setState("error");
    }
  }

  const isAnyLoading = loadingAction !== null;

  return (
    <div style={{
      borderRadius: 10, background: "var(--surface0)",
      border: "1px solid rgba(245,159,0,0.3)",
      overflow: "hidden", marginBottom: 8,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <code style={{ fontSize: 10, color: "var(--overlay0)" }}>{project.slug}</code>
            <span style={{ fontSize: 10, color: "var(--overlay0)", display: "flex", alignItems: "center", gap: 3 }}>
              <GitBranch size={9} /> sprint {sprintNum}
            </span>
            {sprintInfo?.briefing && (
              <span style={{ fontSize: 10, color: "var(--overlay0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                — {sprintInfo.briefing.slice(0, 50)}{sprintInfo.briefing.length > 50 ? "…" : ""}
              </span>
            )}
          </div>
        </div>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 6, fontWeight: 700,
          background: "rgba(245,159,0,0.12)", color: "#f59f00", flexShrink: 0,
        }}>
          pending save
        </span>
      </div>

      {/* Agent Pipeline — collapsible, shows completed sprint pipeline */}
      <div style={{ borderTop: "1px solid rgba(245,159,0,0.15)" }}>
        <button
          onClick={() => setPipelineOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            width: "100%", padding: "7px 14px",
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--overlay0)", fontSize: 11, fontFamily: "var(--font-sans)",
            borderBottom: pipelineOpen ? "1px solid rgba(245,159,0,0.1)" : "none",
          }}
        >
          {pipelineOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Agent Pipeline
          <span style={{ fontSize: 10, color: "var(--overlay0)", marginLeft: 2 }}>
            · {new Set(runs.filter((r) => r.status === "done").map((r) => r.agent)).size} done
          </span>
        </button>
        {pipelineOpen && (
          <div style={{ padding: "12px 14px", background: "var(--crust)" }}>
            <ProjectCanvas
              projectId={project.id}
              projectName={project.name}
              projectSlug={(project as DBProject).slug}
              projectStatus={project.status as string}
              projectPhase={(project as { phase?: string }).phase ?? "validate"}
              projectRepoUrl={(project as { repo_url?: string | null }).repo_url}
              projectBaseRef={(project as { base_ref?: string }).base_ref}
              pipeline={(project.pipeline ?? []) as { step: number; agent: string; gate: string | null }[]}
              externalRuns={runs}
              sprintNum={sprintNum}
              sprintBriefing={sprintInfo?.briefing ?? undefined}
              executionBackend={((project as DBProject).settings?.cli_agents as { execution_backend?: "supabase" | "local" } | undefined)?.execution_backend}
            />
          </div>
        )}
      </div>

      {/* Action bar */}
      {/* ── Action bar ── */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(245,159,0,0.15)" }}>
        <div style={{ fontSize: 11, color: "var(--overlay0)", marginBottom: 8 }}>
          Sprint complete — artifacts are in storage. Export, close, or discard.
        </div>

        {errorMsg && (
          <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={11} />{errorMsg}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {/* Export — opens modal */}
          <button disabled={isAnyLoading || !sprintId} onClick={() => setExportOpen(true)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
            border: "none", background: "#1463ff", color: "#fff",
            fontSize: 12, fontWeight: 700, cursor: isAnyLoading || !sprintId ? "not-allowed" : "pointer",
            opacity: isAnyLoading || !sprintId ? 0.6 : 1, fontFamily: "var(--font-sans)",
          }}>
            <ExternalLink size={12} />
            Export
          </button>

          {/* Close — keep artifacts, close sprint */}
          <button disabled={isAnyLoading || !sprintId} onClick={() => actSimple("close")} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
            border: "1px solid rgba(20,99,255,0.4)", background: "rgba(20,99,255,0.06)", color: "#1463ff",
            fontSize: 12, fontWeight: 600, cursor: isAnyLoading || !sprintId ? "not-allowed" : "pointer",
            opacity: isAnyLoading || !sprintId ? 0.6 : 1, fontFamily: "var(--font-sans)",
          }}>
            {loadingAction === "close" ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle2 size={12} />}
            Close
          </button>

          {/* Discard */}
          <button disabled={isAnyLoading || !sprintId} onClick={() => {
            if (!confirm("Delete all sprint artifacts and close this sprint?")) return;
            actSimple("discard");
          }} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
            border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)",
            fontSize: 12, cursor: isAnyLoading || !sprintId ? "not-allowed" : "pointer",
            opacity: isAnyLoading || !sprintId ? 0.6 : 1, fontFamily: "var(--font-sans)",
          }}>
            {loadingAction === "discard" ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={12} />}
            Discard
          </button>
        </div>
      </div>

      {/* ── Export Modal ── */}
      {exportOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        }} onClick={() => setExportOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 380, background: "var(--mantle)", borderRadius: 12,
            border: "1px solid var(--surface1)", padding: 24,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 16px", color: "var(--text)" }}>
              Export Sprint {sprintNum}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {availableTargets.map((t) => (
                <label key={t.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  borderRadius: 8, border: "1px solid var(--surface1)",
                  background: exportTargets.has(t.id) ? "rgba(20,99,255,0.06)" : "var(--surface0)",
                  cursor: t.available ? "pointer" : "not-allowed",
                  opacity: t.available ? 1 : 0.4,
                }}>
                  <input
                    type="checkbox"
                    checked={exportTargets.has(t.id)}
                    disabled={!t.available}
                    onChange={() => {
                      setExportTargets((prev) => {
                        const next = new Set(prev);
                        if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                        return next;
                      });
                    }}
                    style={{ accentColor: "var(--blue)", cursor: t.available ? "pointer" : "not-allowed" }}
                  />
                  <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{t.label}</span>
                  {!t.available && (
                    <span style={{ fontSize: 10, color: "var(--overlay0)", marginLeft: "auto" }}>not configured</span>
                  )}
                </label>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setExportOpen(false)} style={{
                padding: "7px 14px", borderRadius: 8, border: "1px solid var(--surface1)",
                background: "transparent", color: "var(--subtext0)", fontSize: 12, cursor: "pointer",
                fontFamily: "var(--font-sans)",
              }}>
                Cancel
              </button>
              <button
                disabled={exportTargets.size === 0 || loadingAction === "export"}
                onClick={actExport}
                style={{
                  padding: "7px 14px", borderRadius: 8, border: "none",
                  background: "#1463ff", color: "#fff", fontSize: 12, fontWeight: 700,
                  cursor: exportTargets.size === 0 ? "not-allowed" : "pointer",
                  opacity: exportTargets.size === 0 ? 0.5 : 1,
                  fontFamily: "var(--font-sans)",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {loadingAction === "export" ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> : <ExternalLink size={12} />}
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sprint History */}
      <SprintHistoryPanel projectId={project.id} session={session} runsMap={runsMap} currentSprintInfo={sprintInfo} sprintCount={db.sprint_count} />
    </div>
  );
}

/* ─── SprintHistoryPanel (uses shared SprintRow from ProjectCard) ─── */

function SprintHistoryPanel({ projectId, session, runsMap, currentSprintInfo, sprintCount }: {
  projectId: string;
  session: Session;
  runsMap: Map<string, AgentRun[]>;
  currentSprintInfo?: SprintInfo;
  sprintCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [sprints, setSprints] = useState<SprintSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || sprints !== null || loading) return;
    setLoading(true);
    fetch(`/api/projects/${projectId}/sprints`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (res) => {
        if (res.ok) {
          const body = await res.json() as { sprints: SprintSummary[] };
          setSprints(body.sprints ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [open, sprints, loading, projectId, session.access_token]);

  // Exclude current active sprint from history (it's shown in Agent Pipeline above)
  const historyItems = (sprints ?? []).filter(
    (s) => !currentSprintInfo || s.sprint_num !== currentSprintInfo.sprint_num,
  );

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", padding: "7px 16px",
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--crust)", border: "none", borderTop: "1px solid var(--surface1)",
          cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)",
          color: "var(--subtext0)", fontSize: 11,
        }}
      >
        <GitBranch size={11} color="var(--overlay0)" />
        <span style={{ flex: 1 }}>
          {(sprints !== null ? historyItems.length : (sprintCount ?? 0))} sprint{(sprints !== null ? historyItems.length : (sprintCount ?? 0)) !== 1 ? "s" : ""}
        </span>
        {loading
          ? <RefreshCw size={10} style={{ animation: "spin 1s linear infinite" }} />
          : open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>

      {open && (
        <div style={{ background: "var(--crust)" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--overlay0)", padding: "4px 16px" }}>
              <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Loading…
            </div>
          )}
          {!loading && historyItems.length === 0 && (
            <div style={{ padding: "10px 16px", fontSize: 11, color: "var(--overlay0)" }}>No sprints yet.</div>
          )}
          {historyItems.map((s) => (
            <SprintRow
              key={s.id}
              sprint={{
                id: s.id, sprint_num: s.sprint_num, status: s.status,
                briefing: s.briefing, started_at: s.created_at,
                completed_at: s.completed_at, steps: [],
                trigger_run_id: null, repo_tag: null, tap_status: "pending",
                base_ref: null, commit_sha: null, init_commit_sha: null,
                sprint_completed_saved: s.sprint_completed_saved ?? null,
                config: s.config ?? null,
              } satisfies SharedSprint}
              projectId={projectId}
              projectStatus="completed"
              storageBackend="supabase"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* SprintHistoryRow removed — now uses shared SprintRow from @/components/ProjectCard */

/* ─── Queue primitives ──────────────────────────────── */

function QueueSection({ label, indicator, count, children }: {
  label: string; indicator: React.ReactNode; count: number; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: "var(--overlay0)", marginBottom: 10,
      }}>
        {indicator} {label}
        <span style={{ fontSize: 10, background: "var(--surface1)", borderRadius: 99, padding: "0 5px", lineHeight: "16px", fontWeight: 400, color: "var(--subtext0)" }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

/* ─── Icon button (icon-only, tooltip via title) ────── */
function PipelineIconBtn({ title, icon, color, onClick, disabled, loading }: {
  title: string; icon: React.ReactNode; color: string;
  onClick?: () => void; disabled?: boolean; loading?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 7, border: "none", flexShrink: 0,
        background: `${color}18`, color,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        transition: "opacity 0.12s",
      }}
    >
      {loading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : icon}
    </button>
  );
}

/* ─── Agent run status icon ─────────────────────────────── */
function RunStatusIcon({ status }: { status: string }) {
  if (status === "done")        return <CheckCircle2 size={11} color="#00c2a8" />;
  if (status === "failed")      return <XCircle size={11} color="var(--red)" />;
  if (status === "running")     return <Loader2 size={11} color="#1463ff" style={{ animation: "spin 1s linear infinite" }} />;
  if (status === "waiting")     return <Circle size={11} color="#f59f00" />;
  if (status === "interrupted") return <XCircle size={11} color="var(--yellow, #df8e1d)" />;
  return <Circle size={11} color="var(--overlay0)" />;
}

/* ─── Queue row — same layout for queued / paused / running states ─ */
// status drives which icons appear:
//   "queued"                     → ▶ Play (opens modal) + ⟳ Configure sprint
//   "paused"/"waiting"           → ▶ Continue + ⟳ Restart sprint
//   "executing"/"running"/etc    → ⏸ Pause + collapsible agent runs
function QueueRow({ project, index, sprintCount, activeSprintNum, brief, lastError, state, status, canStart, blockedReason,
                    runs, onPlay, onSprintModal, onRemove, onPause, onMarkCompleted }: {
  project: Project; index?: number;
  sprintCount?: number;
  /** sprint_num of the currently active sprint record — sourced directly from the sprints table,
   *  not from projects.sprint_count, which can be inflated by failed sprint attempts. */
  activeSprintNum?: number;
  brief?: string | null;
  /** Infra-readiness blocker message stored on the project when pipeline fails pre-flight. */
  lastError?: string | null;
  state?: ActionState;
  status: string; canStart: boolean;
  /** Shown in the Start tooltip when canStart=false (e.g. "Factory at capacity (3/3)"). */
  blockedReason?: string;
  runs?: AgentRun[];
  onPlay?: () => void;
  onSprintModal?: () => void;
  onRemove: () => void;
  onPause?: () => void;
  onMarkCompleted?: () => void;
}) {
  const isLoading = state?.loading ?? false;
  const isPaused  = ["paused", "waiting"].includes(status);
  const isRunning = ["executing", "running", "provisioning"].includes(status);
  // Sprint number to display in tooltips:
  //   - If there's an active sprint record → use its sprint_num (source of truth)
  //   - If paused (sprint exists, sprint_count = current num) → use sprint_count
  //   - Otherwise (queued, no sprint yet) → next sprint = sprint_count + 1
  const displaySprintNum = activeSprintNum
    ?? (isPaused ? (sprintCount ?? 1) : (sprintCount ?? 0) + 1);
  const [runsOpen, setRunsOpen] = useState(false);

  const sortedRuns = runs ? [...runs].sort((a, b) => (a.step ?? 0) - (b.step ?? 0)) : [];

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        borderRadius: 10, background: "var(--surface0)",
        border: isRunning ? "1px solid rgba(20,99,255,0.3)" : "1px solid var(--surface1)",
        borderLeft: isRunning ? "3px solid #1463ff" : undefined,
        overflow: "hidden",
      }}>
        {/* Main row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
          {index !== undefined && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--overlay0)", width: 18, textAlign: "center", flexShrink: 0 }}>
              #{index}
            </span>
          )}

          {/* Project info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
              {project.name}
              {(() => {
                const cliCfg = ((project as DBProject).settings?.cli_agents as { execution_backend?: string } | undefined);
                const isLocal = cliCfg?.execution_backend === "local";
                return (
                  <span title={isLocal ? "Local execution" : "Cloud execution"} style={{
                    display: "inline-flex", alignItems: "center", gap: 2,
                    fontSize: 9, padding: "1px 5px", borderRadius: 4, fontWeight: 700,
                    background: isLocal ? "rgba(166,227,161,0.12)" : "rgba(20,99,255,0.10)",
                    color: isLocal ? "var(--green)" : "var(--blue)",
                    flexShrink: 0,
                  }}>
                    {isLocal ? <FolderOpen size={8} /> : <Cloud size={8} />}
                    {isLocal ? "local" : "cloud"}
                  </span>
                );
              })()}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <code style={{ fontSize: 10, color: "var(--overlay0)" }}>{project.slug}</code>
              {sprintCount !== undefined && sprintCount > 0 && (
                <span style={{ fontSize: 10, color: "var(--overlay0)", display: "flex", alignItems: "center", gap: 3 }}>
                  <GitBranch size={9} /> {sprintCount} sprint{sprintCount !== 1 ? "s" : ""}
                </span>
              )}
              {/* Show next sprint number when not running */}
              {!isRunning && (
                <span style={{ fontSize: 10, color: isPaused ? "var(--yellow, #df8e1d)" : "var(--blue, #1463ff)", fontWeight: 500 }}>
                  {isPaused ? `sprint ${displaySprintNum} paused` : `next: sprint ${displaySprintNum}`}
                </span>
              )}
              {isRunning && (
                sortedRuns.length > 0 ? (
                  <button
                    onClick={() => setRunsOpen((o) => !o)}
                    style={{
                      display: "flex", alignItems: "center", gap: 3,
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--subtext0)", fontSize: 10, padding: 0,
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {runsOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    sprint {displaySprintNum} · {sortedRuns.length} agent{sortedRuns.length !== 1 ? "s" : ""}
                  </button>
                ) : (
                  <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--overlay0)" }}>
                    <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} />
                    sprint {displaySprintNum} · initializing…
                  </span>
                )
              )}
            </div>
          </div>

          {!isPaused && !isRunning && <StatusBadge status={status} />}

          {/* Actions — icon only */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {isRunning ? (
              /* Running: only pause */
              <PipelineIconBtn
                title="Pause pipeline after current agent completes"
                icon={<Pause size={13} />}
                color="#f59f00"
                onClick={onPause}
                loading={isLoading}
              />
            ) : (
              <>
                {/* Play/Continue toggle */}
                <PipelineIconBtn
                  title={isPaused
                    ? `Continue Sprint ${displaySprintNum}`
                    : canStart
                      ? `Start Sprint ${displaySprintNum}`
                      : blockedReason ?? "Another project is running"}
                  icon={<Play size={13} />}
                  color="#1463ff"
                  onClick={onPlay}
                  disabled={!canStart && !isPaused}
                  loading={isLoading && !isPaused}
                />

                {/* Sprint modal */}
                <PipelineIconBtn
                  title={isPaused
                    ? `Restart Sprint ${displaySprintNum} — configure and re-run`
                    : `Configure Sprint ${displaySprintNum}`}
                  icon={isPaused ? <RotateCcw size={13} /> : <SkipForward size={13} />}
                  color="#00c2a8"
                  onClick={onSprintModal}
                  loading={false}
                />

                {/* Mark as completed — only visible when paused */}
                {isPaused && onMarkCompleted && (
                  <PipelineIconBtn
                    title="Mark project as completed"
                    icon={<CheckCircle2 size={13} />}
                    color="var(--green, #40a02b)"
                    onClick={onMarkCompleted}
                    loading={isLoading}
                  />
                )}
              </>
            )}

            {/* Remove */}
            <PipelineIconBtn
              title="Remove from pipeline"
              icon={<X size={13} />}
              color="var(--overlay1)"
              onClick={onRemove}
              disabled={isLoading || isRunning}
            />
          </div>
        </div>

        {/* Brief */}
        {brief && !isRunning && (
          <div style={{ padding: "0 14px 10px", paddingLeft: index !== undefined ? 44 : 14 }}>
            <p style={{ fontSize: 11, color: "var(--subtext0)", margin: 0, lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {brief}
            </p>
          </div>
        )}

        {/* Infra-readiness error — shown when paused due to pre-flight failure */}
        {isPaused && lastError && (
          <div style={{
            padding: "6px 14px 10px",
            paddingLeft: index !== undefined ? 44 : 14,
            borderTop: "1px solid rgba(239,68,68,0.2)",
          }}>
            <p style={{
              fontSize: 11, color: "var(--red, #ef4444)", margin: 0, lineHeight: 1.5,
              display: "flex", alignItems: "flex-start", gap: 5,
            }}>
              <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              {lastError}
            </p>
          </div>
        )}

        {/* Agent runs — collapsible, shown only when running and expanded */}
        {isRunning && runsOpen && sortedRuns.length > 0 && (
          <div style={{
            borderTop: "1px solid var(--surface1)",
            padding: "8px 14px 10px",
          }}>
            {sortedRuns.map((run) => (
              <div key={run.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "4px 0",
                borderBottom: "1px solid var(--surface1)",
              }}>
                <RunStatusIcon status={run.status} />
                <span style={{ fontSize: 11, color: "var(--overlay0)", width: 22, flexShrink: 0 }}>
                  {run.step ?? "—"}
                </span>
                <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.agent}
                </span>
                {run.cost_usd > 0 && (
                  <span style={{ fontSize: 10, color: "var(--overlay0)", flexShrink: 0 }}>
                    ${run.cost_usd.toFixed(3)}
                  </span>
                )}
                {run.status === "failed" && run.error && (
                  <span title={run.error} style={{ fontSize: 10, color: "var(--red)", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {run.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inline feedback (error / CLI) */}
      {state?.msg && (() => {
        const isError = state.msg!.type === "error";
        return (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "8px 12px", borderRadius: 8, marginTop: 4,
            background: isError ? "rgba(228,75,95,0.08)" : "rgba(0,194,168,0.06)",
            border: `1px solid ${isError ? "rgba(228,75,95,0.25)" : "rgba(0,194,168,0.2)"}`,
            color: isError ? "var(--red)" : "var(--teal)", fontSize: 12,
          }}>
            {isError && <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span style={{ flex: 1, fontFamily: isError ? "inherit" : "var(--font-mono)", fontSize: isError ? 12 : 11, wordBreak: "break-all" }}>
              {state.msg!.text}
            </span>
          </div>
        );
      })()}
    </div>
  );
}

/* ─── Available CLI agents ──────────────────────────────── */
const AVAILABLE_CLIS = ["claude-code", "aider", "codex", "gemini-cli", "goose", "amp"] as const;

/* ─── Simple hover tooltip ─────────────────────────────── */
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: "var(--crust)", border: "1px solid var(--surface1)", borderRadius: 8,
          padding: "8px 12px", fontSize: 11, color: "var(--subtext0)", lineHeight: 1.5,
          width: 260, zIndex: 400, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          pointerEvents: "none", whiteSpace: "normal",
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

/* ─── Step routing type ────────────────────────────────── */
type StepRoutingMode = "api" | "cli-api" | "cli-subs";
interface StepRoutingEntry { mode: StepRoutingMode; cli?: string }

/* ─── Start Sprint Modal ─────────────────────────────── */
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 8,
  background: "var(--surface0)", border: "1px solid var(--surface1)",
  color: "var(--text)", fontSize: 13, outline: "none",
  fontFamily: "var(--font-sans)", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: "var(--overlay0)",
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};

interface SprintSummary { id: string; sprint_num: number; status: string; created_at: string; completed_at: string | null; briefing: string | null; sprint_completed_saved?: boolean | null; config?: { mode?: string; [key: string]: unknown } | null }
interface SprintInfo { sprint_num: number; created_at: string; trigger_run_id: string | null; briefing: string | null }

function StartSprintModal({
  project, session, runsMap, onClose, onStarted,
}: {
  project: DBProject;
  session: Session;
  runsMap: Map<string, AgentRun[]>;
  onClose: () => void;
  onStarted: (p: Project) => void;
}) {
  // If there's an active sprint in progress (paused/waiting), sprint_count = current sprint number.
  // If queued and no sprint started yet, sprint_count = last completed, so next = +1.
  const hasActiveSprint = ["paused", "waiting", "executing", "running", "provisioning"].includes(project.status as string);
  const sprintNum = hasActiveSprint ? (project.sprint_count ?? 1) : (project.sprint_count ?? 0) + 1;

  // Determine if project has a configured default LLM
  const projProvider = project.settings?.default_provider ?? "";
  const projModel    = project.settings?.default_model ?? "";
  const hasProjectLLM = Boolean(projProvider);

  const cliCfg      = project.settings?.cli_agents as { enabled?: boolean; execution_mode?: "cloud" | "local"; default_cli?: string; agent_overrides?: Record<string, { enabled?: boolean; cli?: string }> } | undefined;
  const cliEnabled  = cliCfg?.enabled === true;

  // Compute per-step execution mode from the pipeline
  const pipelineSteps = (project.pipeline ?? []) as { step: number; agent: string; phaseName?: string }[];
  const stepModes = pipelineSteps.map((s) => {
    const override = cliEnabled ? (cliCfg?.agent_overrides?.[s.agent] ?? null) : null;
    const usesCli  = override?.enabled === true;
    return { ...s, usesCli, cli: usesCli ? (override?.cli ?? "cli") : null };
  });
  // apiSteps/cliSteps moved below stepRouting declaration

  // Compute available resume steps for paused sprints
  const pipelineStepsAll = (project.pipeline ?? []) as { step: number; agent: string }[];
  const doneSteps = new Set(
    (runsMap.get(project.id) ?? [])
      .filter((r) => r.status === "done")
      .map((r) => r.step),
  );
  // Step N is available if: N === 1 OR step N-1 is done
  const availableSteps = pipelineStepsAll.filter(
    (s) => s.step === 1 || doneSteps.has(s.step - 1),
  );
  const autoResumeStep = availableSteps.length > 0
    ? Math.max(...availableSteps.map((s) => s.step))
    : 1;

  // ── Defaults from project settings ──────────────────────
  const projectDefaults = React.useMemo(() => ({
    mode:        (project.settings?.cli_agents as { execution_backend?: string } | undefined)?.execution_backend === "supabase" ? "cloud" as const : "local" as const,
    bypassGates: true,
    llmSource:   (hasProjectLLM ? "project" : "global") as "project" | "global",
    provider:    projProvider,
    model:       projModel,
  }), [project.settings, hasProjectLLM, projProvider, projModel]);

  // ── Load last sprint config for inheritance ────────────
  const [lastSprintConfig, setLastSprintConfig] = useState<{
    mode?: string; provider?: string; model?: string;
    bypassGates?: boolean; stepRouting?: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    supabase
      .from("sprints")
      .select("config")
      .eq("project_id", project.id)
      .not("config", "is", null)
      .order("sprint_num", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.config && typeof data.config === "object") {
          setLastSprintConfig(data.config as typeof lastSprintConfig);
        }
      });
  }, [project.id]);

  // ── Initialize from last sprint or project defaults ────
  const initMode = (lastSprintConfig?.mode as "cloud" | "local" | undefined) ?? projectDefaults.mode;
  const initBypass = lastSprintConfig?.bypassGates ?? projectDefaults.bypassGates;
  const initLlmSource = lastSprintConfig?.provider ? "global" as const : projectDefaults.llmSource;
  const initProvider = lastSprintConfig?.provider ?? projectDefaults.provider;
  const initModel = lastSprintConfig?.model ?? projectDefaults.model;

  const [briefing,         setBriefing]         = useState("");
  const [bypassGates,      setBypassGates]      = useState(initBypass);
  // "project" = use project settings (send undefined to API, let pipeline resolve)
  // "global"  = user picks explicitly from the live provider list
  const [llmSource,        setLlmSource]        = useState<"project" | "global">(initLlmSource);
  const [provider,         setProvider]         = useState(initProvider);
  const [model,            setModel]            = useState(initModel);
  // CLI execution mode — sprint-level override
  const [cliMode,          setCliMode]          = useState<"project" | "cloud" | "local">(initMode);

  // Update state when lastSprintConfig loads (async)
  useEffect(() => {
    if (!lastSprintConfig) return;
    if (lastSprintConfig.mode) setCliMode(lastSprintConfig.mode as "cloud" | "local");
    if (lastSprintConfig.bypassGates !== undefined) setBypassGates(lastSprintConfig.bypassGates);
    if (lastSprintConfig.provider) { setLlmSource("global"); setProvider(lastSprintConfig.provider); }
    if (lastSprintConfig.model) setModel(lastSprintConfig.model);
  }, [lastSprintConfig]);

  // Reset to project defaults
  function resetToDefaults() {
    setCliMode(projectDefaults.mode);
    setBypassGates(projectDefaults.bypassGates);
    setLlmSource(projectDefaults.llmSource);
    setProvider(projectDefaults.provider);
    setModel(projectDefaults.model);
    setBriefing("");
    // stepRouting will reset via cliMode useEffect
  }
  const [running,          setRunning]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [cliCmd,           setCliCmd]           = useState<string | null>(null);
  const [liveProviders,    setLiveProviders]    = useState<LiveProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  // Cross-sprint context
  const [contextOpen,      setContextOpen]      = useState(false);
  const [pastSprints,      setPastSprints]      = useState<SprintSummary[]>([]);
  const [loadingSprints,   setLoadingSprints]   = useState(false);
  const [contextSprintIds, setContextSprintIds] = useState<string[]>([]);
  const [contextCategories, setContextCategories] = useState<("specs" | "docs")[]>(["specs", "docs"]);
  // Resume step — only relevant when hasActiveSprint; "auto" = server-computed
  const [resumeStep,       setResumeStep]       = useState<number | "auto">("auto");
  // Per-step sprint instructions: stepNum → { text, override }
  const [stepInstructions, setStepInstructions] = useState<Map<number, { text: string; override: boolean }>>(new Map());
  // Which step's instruction modal is open (null = none)
  const [editingStep,      setEditingStep]      = useState<number | null>(null);
  // Draft state for the open instruction editor
  const [draftText,        setDraftText]        = useState("");
  const [draftOverride,    setDraftOverride]    = useState(false);
  // Per-step routing overrides (sprint-level)
  const [stepRouting,      setStepRouting]      = useState<Map<number, StepRoutingEntry>>(() => {
    const m = new Map<number, StepRoutingEntry>();
    // When orchestration mode is "local", default all steps to CLI SUBS
    const defaultToCli = cliMode === "local";
    stepModes.forEach((s) => {
      if (s.usesCli || defaultToCli) {
        m.set(s.step, { mode: "cli-subs", cli: s.cli ?? "claude-code" });
      } else {
        m.set(s.step, { mode: "api" });
      }
    });
    return m;
  });

  // When cliMode changes, reset all steps to match the mode
  useEffect(() => {
    setStepRouting(() => {
      const m = new Map<number, StepRoutingEntry>();
      const defaultToCli = cliMode === "local";
      stepModes.forEach((s) => {
        if (defaultToCli) {
          m.set(s.step, { mode: "cli-subs", cli: s.cli ?? "claude-code" });
        } else {
          m.set(s.step, { mode: "api" });
        }
      });
      return m;
    });
  }, [cliMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive apiSteps/cliSteps from stepRouting (reflects modal changes)
  const apiSteps = stepModes.filter((s) => (stepRouting.get(s.step)?.mode ?? "api") === "api");
  const cliSteps = stepModes.filter((s) => (stepRouting.get(s.step)?.mode ?? "api") !== "api");

  useEffect(() => {
    if (!contextOpen || pastSprints.length > 0 || loadingSprints) return;
    setLoadingSprints(true);
    fetch(`/api/projects/${project.id}/sprints`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        if (res.ok) {
          const body = await res.json() as { sprints: SprintSummary[] };
          setPastSprints(body.sprints ?? []);
        }
      })
      .finally(() => setLoadingSprints(false));
  }, [contextOpen, pastSprints.length, loadingSprints, project.id, session.access_token]);

  useEffect(() => {
    setLoadingProviders(true);
    fetch("/api/wizard/models", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (res) => {
        if (res.ok) {
          const body = await res.json() as { providers: LiveProvider[] };
          const providers = body.providers ?? [];
          setLiveProviders(providers);
          if (providers[0]) { setProvider(providers[0].id); setModel(providers[0].models[0]?.id ?? ""); }
        }
      })
      .finally(() => setLoadingProviders(false));
  }, [session]);

  async function handleRun() {
    setRunning(true); setError(null);
    try {
      const useProjectSettings = llmSource === "project";
      const res = await fetch(`/api/projects/${project.id}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          briefing:            briefing || undefined,
          bypassGates:         bypassGates || undefined,
          provider:            useProjectSettings ? undefined : provider,
          model:               useProjectSettings ? undefined : model,
          cliExecutionMode:    cliMode,
          ...(contextSprintIds.length > 0 ? { contextSprintIds } : {}),
          ...(contextSprintIds.length > 0 && contextCategories.length < 2 ? { contextCategories } : {}),
          ...(hasActiveSprint && resumeStep !== "auto" ? { startFromStep: resumeStep } : {}),
          ...(stepInstructions.size > 0 ? {
            agentInstructions: Object.fromEntries(
              [...stepInstructions.entries()].map(([step, v]) => [String(step), v])
            ),
          } : {}),
          ...(stepRouting.size > 0 ? {
            stepRoutingOverrides: Object.fromEntries(
              [...stepRouting.entries()].map(([step, r]) => [
                String(step),
                r.mode === "api"
                  ? { cliOverride: { enabled: false } }
                  : { cliOverride: { enabled: true, cli: r.cli ?? "claude-code", authMode: r.mode === "cli-api" ? "api-key" : "oauth" } },
              ])
            ),
          } : {}),
        }),
      });
      let body: { triggered?: boolean; cli_command?: string | null; error?: string } = {};
      try { body = await res.json(); } catch { /* non-JSON response (e.g. 504) */ }
      if (res.status === 429) { setError("Factory is at its concurrent project limit. Wait for a running sprint to finish, or raise Max concurrent projects in Factory Settings."); return; }
      if (!res.ok) { setError(body.error ?? `Start failed (${res.status}).`); return; }
      if (body.cli_command) { setCliCmd(body.cli_command); return; }
      if (!body.triggered) { setError("Trigger.dev not configured. Check Integrations → Platforms."); return; }
      onStarted({ ...project, status: "executing" as Project["status"] });
    } catch (e) {
      setError((e as Error).message ?? "Network error — could not reach server.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "var(--mantle)", border: "1px solid var(--surface0)", borderRadius: 18, width: "min(520px, 95vw)", padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Start Sprint {sprintNum}</div>
            <div style={{ fontSize: 11, color: "var(--overlay0)" }}>{project.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={resetToDefaults} title="Reset to project defaults" style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6,
              border: "1px solid var(--surface1)", background: "transparent",
              color: "var(--overlay0)", fontSize: 10, cursor: "pointer", fontFamily: "var(--font-sans)",
            }}>
              <RotateCcw size={10} /> Reset
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--overlay0)" }}><X size={16} /></button>
          </div>
        </div>

        {cliCmd ? (
          <>
            <div style={{ background: "var(--crust)", border: "1px solid var(--surface0)", borderRadius: 10, padding: "12px 16px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--green)", marginBottom: 12 }}>{cliCmd}</div>
            <button onClick={onClose} style={{ width: "100%", padding: "9px", borderRadius: 9, border: "none", background: "#1463ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Close</button>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Sprint briefing <span style={{ fontWeight: 400 }}>(optional)</span></label>
              <textarea value={briefing} onChange={(e) => setBriefing(e.target.value)}
                placeholder={project.intake_brief ?? "Any specific focus for this sprint?"}
                rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
            </div>

            {/* ── Orchestration Mode ── */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>
                Orchestration Mode
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {([
                  { id: "local" as const, label: "Local", tooltip: "Tasks are orchestrated by Trigger.dev but executed on your local machine via `trigger dev`. Use CLIs with subscription and edit artifacts on your filesystem." },
                  { id: "cloud" as const, label: "Cloud", tooltip: "Tasks run entirely on Trigger.dev cloud workers. Artifacts are stored in Supabase and can be downloaded or pushed to Git." },
                ] as const).map((opt) => {
                  const active = cliMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setCliMode(opt.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 7,
                        padding: "7px 14px", borderRadius: 8, cursor: "pointer",
                        border: `1.5px solid ${active ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                        background: active ? "rgba(20,99,255,0.08)" : "var(--surface0)",
                        color: active ? "#1463ff" : "var(--subtext0)",
                        fontSize: 13, fontWeight: active ? 700 : 400, fontFamily: "var(--font-sans)",
                      }}
                    >
                      <span style={{ fontSize: 15, lineHeight: 1 }}>{active ? "\u25CF" : "\u25CB"}</span>
                      {opt.label}
                      <Tooltip text={opt.tooltip}>
                        <HelpCircle size={13} style={{ color: "var(--overlay0)", cursor: "help" }} />
                      </Tooltip>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--surface0)", margin: "14px 0" }} />

            {/* ── Execution — unified section showing API vs CLI per step ── */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Execution</label>

              {/* Step breakdown — always visible so the user knows what will run */}
              {stepModes.length > 0 && (
                <div style={{
                  background: "var(--crust)", borderRadius: 8, padding: "8px 10px",
                  marginBottom: 10, display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Steps</span>
                    <a href="/projects" style={{ fontSize: 10, color: "var(--blue)", textDecoration: "none", marginLeft: 8 }}>Configure routing →</a>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, width: 72, textAlign: "center" }}>Instruction</span>
                  </div>
                  {stepModes.map((s) => {
                    const instr = stepInstructions.get(s.step);
                    const hasInstr = Boolean(instr?.text);
                    const routing = stepRouting.get(s.step) ?? { mode: s.usesCli ? "cli-subs" as StepRoutingMode : "api" as StepRoutingMode, cli: s.cli ?? undefined };
                    const ROUTING_OPTIONS: { id: StepRoutingMode; label: string; bg: string; fg: string }[] = [
                      { id: "api",      label: "API",      bg: "rgba(20,99,255,0.10)",   fg: "#1463ff" },
                      { id: "cli-api",  label: "CLI API",  bg: "rgba(166,227,161,0.12)", fg: "var(--green)" },
                      { id: "cli-subs", label: "CLI SUBS", bg: "rgba(249,226,175,0.12)", fg: "var(--yellow)" },
                    ];
                    const activeOpt = ROUTING_OPTIONS.find((o) => o.id === routing.mode) ?? ROUTING_OPTIONS[0];
                    return (
                      <div key={s.step} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                        <span style={{ color: "var(--overlay0)", width: 18, flexShrink: 0, textAlign: "right" }}>{s.step}</span>
                        <span style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.agent}</span>
                        {/* Routing mode selector */}
                        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                          {ROUTING_OPTIONS.map((opt) => {
                            const isActive = routing.mode === opt.id;
                            return (
                              <button
                                key={opt.id}
                                onClick={() => {
                                  setStepRouting((prev) => {
                                    const m = new Map(prev);
                                    const cur = m.get(s.step) ?? { mode: "api" as StepRoutingMode };
                                    m.set(s.step, { ...cur, mode: opt.id, cli: opt.id !== "api" ? (cur.cli ?? s.cli ?? "claude-code") : undefined });
                                    return m;
                                  });
                                }}
                                style={{
                                  padding: "1px 5px", borderRadius: 4, fontSize: 9, fontWeight: isActive ? 700 : 500,
                                  background: isActive ? opt.bg : "transparent",
                                  color: isActive ? opt.fg : "var(--overlay0)",
                                  border: isActive ? `1px solid ${opt.fg}33` : "1px solid transparent",
                                  cursor: "pointer", fontFamily: "var(--font-sans)",
                                  lineHeight: "16px", whiteSpace: "nowrap",
                                }}
                                title={
                                  opt.id === "api" ? "Uses provider API directly (no CLI)"
                                  : opt.id === "cli-api" ? "Uses CLI headless with API key"
                                  : "Uses CLI with subscription/OAuth"
                                }
                              >{opt.label}</button>
                            );
                          })}
                        </div>
                        {/* CLI selector — shown when cli-api or cli-subs */}
                        {routing.mode !== "api" && (
                          <select
                            value={routing.cli ?? "claude-code"}
                            onChange={(e) => {
                              setStepRouting((prev) => {
                                const m = new Map(prev);
                                const cur = m.get(s.step) ?? { mode: routing.mode };
                                m.set(s.step, { ...cur, cli: e.target.value });
                                return m;
                              });
                            }}
                            style={{
                              padding: "1px 4px", borderRadius: 4, fontSize: 9, fontWeight: 600,
                              background: "var(--surface0)", border: "1px solid var(--surface1)",
                              color: "var(--text)", cursor: "pointer", fontFamily: "var(--font-sans)",
                              height: 20, flexShrink: 0,
                            }}
                          >
                            {AVAILABLE_CLIS.map((cli) => (
                              <option key={cli} value={cli}>{cli}</option>
                            ))}
                          </select>
                        )}
                        <div style={{ width: 72, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                          <button
                            onClick={() => {
                              setDraftText(instr?.text ?? "");
                              setDraftOverride(instr?.override ?? false);
                              setEditingStep(s.step);
                            }}
                            title={hasInstr ? `Edit instruction (${instr!.override ? "override" : "append"})` : "Add sprint instruction"}
                            style={{
                              background: hasInstr ? "rgba(20,99,255,0.08)" : "none",
                              border: hasInstr ? "1px solid rgba(20,99,255,0.25)" : "1px solid transparent",
                              cursor: "pointer", padding: "2px 6px",
                              borderRadius: 4, display: "flex", alignItems: "center", gap: 4,
                              color: hasInstr ? "var(--blue)" : "var(--overlay0)",
                            }}
                          >
                            <Pencil size={10} />
                            {hasInstr && <span style={{ fontSize: 9, fontWeight: 700 }}>{instr!.override ? "OVR" : "ADD"}</span>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Per-step agent instruction editor modal */}
              {editingStep !== null && (() => {
                const stepInfo = stepModes.find((s) => s.step === editingStep);
                return (
                  <div style={{
                    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
                    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
                  }}>
                    <div style={{
                      background: "var(--mantle)", border: "1px solid var(--surface1)",
                      borderRadius: 14, width: "min(420px, 92vw)", padding: 20,
                      boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>Sprint Instruction</div>
                          <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2 }}>
                            Step {editingStep} · <span style={{ color: "var(--text)" }}>{stepInfo?.agent}</span>
                          </div>
                        </div>
                        <button onClick={() => setEditingStep(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--overlay0)" }}>
                          <X size={15} />
                        </button>
                      </div>

                      <textarea
                        autoFocus
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        placeholder="Enter specific instructions for this agent in this sprint…"
                        rows={5}
                        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, marginBottom: 12 }}
                      />

                      <label style={{
                        display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                        padding: "8px 10px", borderRadius: 8, marginBottom: 14,
                        border: `1px solid ${draftOverride ? "rgba(249,226,175,0.4)" : "var(--surface1)"}`,
                        background: draftOverride ? "rgba(249,226,175,0.06)" : "transparent",
                      }}>
                        <input
                          type="checkbox"
                          checked={draftOverride}
                          onChange={(e) => setDraftOverride(e.target.checked)}
                          style={{ marginTop: 2, accentColor: "#f9e2af" }}
                        />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: draftOverride ? "var(--yellow)" : "var(--text)" }}>Override</div>
                          <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2 }}>
                            {draftOverride
                              ? "This instruction replaces the agent's original instructions."
                              : "This instruction is appended to the agent's original instructions."}
                          </div>
                        </div>
                      </label>

                      <div style={{ display: "flex", gap: 8 }}>
                        {stepInstructions.has(editingStep) && (
                          <button
                            onClick={() => {
                              setStepInstructions((prev) => { const m = new Map(prev); m.delete(editingStep); return m; });
                              setEditingStep(null);
                            }}
                            style={{
                              padding: "8px 14px", borderRadius: 8, border: "1px solid var(--surface1)",
                              background: "transparent", color: "var(--red)", fontSize: 12,
                              cursor: "pointer", fontFamily: "var(--font-sans)",
                            }}
                          >Remove</button>
                        )}
                        <button
                          onClick={() => setEditingStep(null)}
                          style={{
                            padding: "8px 14px", borderRadius: 8, border: "1px solid var(--surface1)",
                            background: "transparent", color: "var(--subtext0)", fontSize: 12,
                            cursor: "pointer", fontFamily: "var(--font-sans)", marginLeft: "auto",
                          }}
                        >Cancel</button>
                        <button
                          onClick={() => {
                            if (draftText.trim()) {
                              setStepInstructions((prev) => new Map(prev).set(editingStep, { text: draftText.trim(), override: draftOverride }));
                            } else {
                              setStepInstructions((prev) => { const m = new Map(prev); m.delete(editingStep); return m; });
                            }
                            setEditingStep(null);
                          }}
                          style={{
                            padding: "8px 16px", borderRadius: 8, border: "none",
                            background: "#1463ff", color: "#fff", fontSize: 12, fontWeight: 700,
                            cursor: "pointer", fontFamily: "var(--font-sans)",
                          }}
                        >Save</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* API steps config — only shown when there are API steps */}
              {apiSteps.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--overlay0)", marginBottom: 6 }}>
                    LLM for <strong style={{ color: "var(--text)" }}>{apiSteps.length} API step{apiSteps.length !== 1 ? "s" : ""}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    {(["project", "global"] as const).map((src) => {
                      const active = llmSource === src;
                      const label = src === "project"
                        ? `Project${hasProjectLLM ? ` (${projProvider}${projModel ? ` / ${projModel.split("-").slice(0,2).join("-")}` : ""})` : " — not set"}`
                        : "Global";
                      const disabled = src === "project" && !hasProjectLLM;
                      return (
                        <button
                          key={src}
                          disabled={disabled}
                          onClick={() => !disabled && setLlmSource(src)}
                          style={{
                            display: "flex", alignItems: "center", gap: 7,
                            padding: "5px 11px", borderRadius: 8, cursor: disabled ? "default" : "pointer",
                            border: `1.5px solid ${active ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                            background: active ? "rgba(20,99,255,0.08)" : "var(--surface0)",
                            color: disabled ? "var(--overlay0)" : active ? "#1463ff" : "var(--subtext0)",
                            fontSize: 12, fontWeight: active ? 700 : 400, fontFamily: "var(--font-sans)",
                            opacity: disabled ? 0.5 : 1,
                          }}
                        >
                          <span style={{ fontSize: 14, lineHeight: 1 }}>{active ? "●" : "○"}</span>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {llmSource === "global" && (
                    loadingProviders ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--overlay0)", padding: "4px 0" }}>
                        <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> Loading…
                      </div>
                    ) : liveProviders.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--yellow)", padding: "4px 0" }}>
                        No providers configured. <a href="/providers" style={{ color: "var(--blue)" }}>Add an API key.</a>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(liveProviders.find((p) => p.id === e.target.value)?.models[0]?.id ?? ""); }}
                          style={{ ...inputStyle, padding: "6px 10px", height: 34, width: 140 }}>
                          {liveProviders.map((p) => <option key={p.id} value={p.id}>{PROVIDER_NAMES[p.id] ?? p.id}</option>)}
                        </select>
                        <select value={model} onChange={(e) => setModel(e.target.value)}
                          style={{ ...inputStyle, padding: "6px 10px", height: 34, flex: 1 }}>
                          {(liveProviders.find((p) => p.id === provider)?.models ?? []).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                        </select>
                      </div>
                    )
                  )}
                </div>
              )}

            </div>

            {/* Bypass gates */}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 10, border: `1px solid ${bypassGates ? "var(--yellow)" : "var(--surface1)"}`, background: bypassGates ? "rgba(249,226,175,0.06)" : "transparent", marginBottom: 8 }}>
              <input type="checkbox" checked={bypassGates} onChange={(e) => setBypassGates(e.target.checked)} style={{ marginTop: 2, accentColor: "#f9e2af" }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: bypassGates ? "var(--yellow)" : "var(--text)" }}>Bypass human gates</div>
                <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2 }}>Auto-approve all gate pauses — pipeline runs fully unattended.</div>
              </div>
            </label>

            {/* ── Collapsible: Context & Resume ── */}
            <div style={{ borderRadius: 10, border: "1px solid var(--surface1)", marginBottom: 14, overflow: "hidden" }}>
              <button
                onClick={() => setContextOpen((o) => !o)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer",
                  color: (contextSprintIds.length > 0 || (hasActiveSprint && resumeStep !== "auto")) ? "var(--blue)" : "var(--subtext0)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  {contextOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Context &amp; Resume
                  {contextSprintIds.length > 0 && (
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(20,99,255,0.12)", color: "#1463ff", fontWeight: 700 }}>
                      {contextSprintIds.length} sprint{contextSprintIds.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {hasActiveSprint && resumeStep !== "auto" && (
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(20,99,255,0.12)", color: "#1463ff", fontWeight: 700 }}>
                      from step {resumeStep}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: "var(--overlay0)" }}>optional</span>
              </button>

              {contextOpen && (
                <div style={{ padding: "0 12px 12px 12px", borderTop: "1px solid var(--surface1)" }}>
                  {/* Resume step selector — only for active/paused sprints */}
                  {hasActiveSprint && availableSteps.length > 0 && (
                    <div style={{ marginTop: 10, marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                        Resume from step
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        <button
                          onClick={() => setResumeStep("auto")}
                          style={{
                            padding: "3px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                            fontFamily: "var(--font-sans)", fontWeight: resumeStep === "auto" ? 700 : 400,
                            border: `1px solid ${resumeStep === "auto" ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                            background: resumeStep === "auto" ? "rgba(20,99,255,0.08)" : "transparent",
                            color: resumeStep === "auto" ? "#1463ff" : "var(--subtext0)",
                          }}
                        >
                          Auto (step {autoResumeStep})
                        </button>
                        {availableSteps.map((s) => (
                          <button
                            key={s.step}
                            onClick={() => setResumeStep(s.step)}
                            style={{
                              padding: "3px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                              fontFamily: "var(--font-sans)", fontWeight: resumeStep === s.step ? 700 : 400,
                              border: `1px solid ${resumeStep === s.step ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                              background: resumeStep === s.step ? "rgba(20,99,255,0.08)" : "transparent",
                              color: resumeStep === s.step ? "#1463ff" : "var(--subtext0)",
                              maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                            title={`Step ${s.step}: ${s.agent}`}
                          >
                            {s.step}. {s.agent}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cross-sprint context */}
                  <div style={{ marginTop: hasActiveSprint ? 0 : 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      Context from previous sprints
                    </div>

                    {loadingSprints ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--overlay0)", padding: "4px 0" }}>
                        <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} /> Loading…
                      </div>
                    ) : pastSprints.length === 0 ? (
                      <div style={{ fontSize: 11, color: "var(--overlay0)", padding: "4px 0" }}>No completed sprints to reference.</div>
                    ) : (
                      <>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                          {pastSprints.map((s) => {
                            const checked = contextSprintIds.includes(s.id);
                            return (
                              <label key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    setContextSprintIds((prev) =>
                                      e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                                    );
                                  }}
                                  style={{ marginTop: 2, accentColor: "#1463ff" }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: checked ? "var(--text)" : "var(--subtext0)" }}>
                                    Sprint {s.sprint_num}
                                  </span>
                                  {s.briefing && (
                                    <span style={{ fontSize: 11, color: "var(--overlay0)", marginLeft: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      — {s.briefing.slice(0, 50)}{s.briefing.length > 50 ? "…" : ""}
                                    </span>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>

                        {contextSprintIds.length > 0 && (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: "var(--overlay0)", marginRight: 4 }}>Include:</span>
                            {(["specs", "docs"] as const).map((cat) => {
                              const active = contextCategories.includes(cat);
                              return (
                                <button
                                  key={cat}
                                  onClick={() => setContextCategories((prev) =>
                                    active
                                      ? prev.filter((c) => c !== cat)
                                      : [...prev, cat]
                                  )}
                                  style={{
                                    padding: "2px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                                    fontFamily: "var(--font-sans)", fontWeight: active ? 700 : 400,
                                    border: `1px solid ${active ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                                    background: active ? "rgba(20,99,255,0.08)" : "transparent",
                                    color: active ? "#1463ff" : "var(--subtext0)",
                                    textTransform: "capitalize",
                                  }}
                                >
                                  {cat}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={12} />{error}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 13, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Cancel</button>
              <button onClick={handleRun} disabled={running} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px", borderRadius: 9, border: "none", background: "#1463ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: running ? "not-allowed" : "pointer", opacity: running ? 0.7 : 1, fontFamily: "var(--font-sans)" }}>
                {running ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Starting…</> : <><Play size={12} /> Run Sprint {sprintNum}</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Add to Queue Modal ─────────────────────────────── */
function AddToQueueModal({
  projects, actionStates, onAdd, onClose,
}: {
  projects: Project[];
  actionStates: Record<string, ActionState>;
  onAdd: (p: Project) => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--mantle)", border: "1px solid var(--surface0)", borderRadius: 18, width: "min(480px, 95vw)", maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--surface0)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Add project to pipeline</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--overlay0)" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {projects.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--overlay0)", fontSize: 13 }}>
              All projects are already in the pipeline.
            </div>
          ) : (
            projects.map((project) => {
              const st = actionStates[project.id];
              return (
                <button
                  key={project.id}
                  disabled={st?.loading}
                  onClick={() => onAdd(project)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, width: "100%",
                    padding: "12px 14px", borderRadius: 10, marginBottom: 8,
                    background: "var(--surface0)", border: "1px solid var(--surface1)",
                    cursor: st?.loading ? "not-allowed" : "pointer", textAlign: "left",
                    opacity: st?.loading ? 0.6 : 1, transition: "border-color 0.12s",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {st?.loading
                    ? <Loader2 size={16} color="var(--blue)" style={{ animation: "spin 1s linear infinite" }} />
                    : <Plus size={16} color="var(--blue)" />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{project.name}</div>
                    <code style={{ fontSize: 10, color: "var(--overlay0)" }}>{project.slug}</code>
                  </div>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "var(--surface1)", color: "var(--overlay0)", textTransform: "uppercase", fontWeight: 600 }}>
                    {project.status}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
