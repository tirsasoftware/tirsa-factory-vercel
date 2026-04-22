"use client";

import React, { useState } from "react";
import {
  Zap, GitBranch, FolderOpen, Cloud, Clock, CheckCircle2,
  XCircle, ExternalLink,
  RefreshCw, Trash2, Lock, Unlock, Settings,
  ChevronDown, ChevronUp, ChevronRight, FileText, Loader2, Download, Copy,
  Brain, HardDrive, Cpu, Timer, Coins,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface Sprint {
  id: string; sprint_num: number; status: string; briefing: string | null;
  trigger_run_id: string | null; repo_tag: string | null; tap_status: string;
  base_ref: string | null; started_at: string; completed_at: string | null; steps: unknown[];
  commit_sha: string | null; init_commit_sha: string | null;
  sprint_completed_saved?: boolean | null;
  config?: { mode?: string; [key: string]: unknown } | null;
}

interface RunMetrics {
  heap_start_mb?: number;
  heap_peak_mb?: number;
  heap_end_mb?: number;
  wall_ms?: number;
  llm_ms?: number;
  artifact_count?: number;
  tokens_in?: number;
  tokens_out?: number;
  model?: string | null;
  provider?: string;
  error?: boolean;
}

interface SprintAgentRun {
  id: string; agent: string; status: string; step: number | null;
  cost_usd: number; started_at: string | null; finished_at: string | null;
  output_ref: string | null; run_type: string | null;
  tokens_in: number | null; tokens_out: number | null;
  metrics: RunMetrics | null; output_size_bytes: number | null;
}

export interface Project {
  id: string; name: string; slug: string; status: string; phase: string;
  mode: "new" | "adopt"; intake_brief: string | null; pipeline_id: string | null;
  repo_url: string | null; sprint_count: number; base_ref: string | null;
  locked: boolean; settings?: ProjectSettings;
  created_at: string; updated_at: string;
}

export interface ProjectSettings {
  storage_backend_type?: "supabase" | "local";
  storage_backend_name?: string;
  cli_agents?: {
    execution_backend?: string;
    local_base_path?: string;
  };
  [key: string]: unknown;
}

interface SprintFilesData {
  artifacts: { agent: string; step: number | null; status: string; outputRef: string; costUsd: number | null }[];
  storageBackend: "supabase" | "local" | "unavailable";
  storageFiles: { path: string; size: number | null }[];
  localError: string | null;
  gitInfo: { repoUrl: string; tagsUrl: string; commitsUrl: string } | null;
}

/* ── Status helpers ────────────────────────────────────────────────────────── */

const STATUS_COLOR: Record<string, string> = {
  provisioning: "#6b7a9e", ready: "#10b981", executing: "#1463ff",
  waiting: "#f59f00", completed: "#00c2a8", paused: "#f59f00",
  cancelled: "#6b7a9e", failed: "#e44b5f",
  queued: "#6b7a9e", running: "#1463ff",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  executing: <Zap size={11} />, running: <Zap size={11} />,
  waiting: <Clock size={11} />, completed: <CheckCircle2 size={11} />,
  failed: <XCircle size={11} />, cancelled: <XCircle size={11} />,
};

const ACTIVE_STATUSES = ["executing", "running", "provisioning", "queued"];
const QUEUE_STATUSES = new Set(["queued", "executing", "running", "waiting", "paused", "provisioning"]);

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "#6b7a9e";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
      padding: "2px 8px", borderRadius: 99,
      background: `${color}18`, color,
    }}>
      {STATUS_ICON[status]} {status}
    </span>
  );
}

/* ── Observability helpers ─────────────────────────────────────────────────── */

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function MetricChip({ icon, label, value, color, title }: {
  icon: React.ReactNode; label?: string; value: string; color?: string; title?: string;
}) {
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 9, padding: "1px 5px", borderRadius: 4,
      background: "var(--surface0)", color: color ?? "var(--subtext0)",
      fontFamily: "var(--font-mono)", whiteSpace: "nowrap", flexShrink: 0,
    }}>
      {icon}
      {label && <span style={{ color: "var(--overlay0)", fontFamily: "var(--font-sans)" }}>{label}</span>}
      {value}
    </span>
  );
}

/* ── Small icon button ─────────────────────────────────────────────────────── */

function IconBtn({ title, color, bg, onClick, disabled, children }: {
  title: string; color: string; bg: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, borderRadius: 6, border: "none",
        background: bg, color, flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}

/* ── Sprint Row ────────────────────────────────────────────────────────────── */

export function SprintRow({ sprint: s, projectId, projectSlug, projectStatus, storageBackend: defaultBackend }: {
  sprint: Sprint;
  projectId: string;
  projectSlug?: string;
  projectStatus: string;
  storageBackend: "supabase" | "local";
}) {
  // Sprint config mode takes precedence over project default
  const storageBackend: "supabase" | "local" = s.config?.mode === "local" ? "local" : defaultBackend;
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<SprintAgentRun[] | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [filesData, setFilesData] = useState<SprintFilesData | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [gitTags, setGitTags] = useState<{ name: string }[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const sc = STATUS_COLOR[s.status] ?? "#6b7a9e";

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (downloading || !session) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/sprints/${s.id}/download`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { console.error("Download failed", await res.text()); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sprint-${s.sprint_num}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error", err);
    } finally {
      setDownloading(false);
    }
  }

  function toggle() {
    if (!open && runs === null && !loadingRuns) {
      setLoadingRuns(true);
      supabase
        .from("agent_runs")
        .select("id, agent, status, step, cost_usd, started_at, finished_at, output_ref, run_type, tokens_in, tokens_out, metrics, output_size_bytes")
        .eq("project_id", projectId)
        .gte("created_at", s.started_at)
        .order("step", { ascending: true })
        .then(({ data }) => {
          setRuns((data ?? []) as SprintAgentRun[]);
          setLoadingRuns(false);
        });
    }
    setOpen((o) => !o);
  }

  function openExplorer(e: React.MouseEvent) {
    e.stopPropagation();
    setExplorerOpen((o) => !o);
    if (!filesData && !filesLoading && session) {
      setFilesLoading(true);
      fetch(`/api/projects/${projectId}/sprints/${s.id}/files`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(async (r) => { if (r.ok) setFilesData(await r.json() as SprintFilesData); })
        .finally(() => setFilesLoading(false));
    }
  }

  React.useEffect(() => {
    if (!explorerOpen || !filesData?.gitInfo || gitTags !== null) return;
    fetch(filesData.gitInfo.tagsUrl, { headers: { Accept: "application/vnd.github+json" } })
      .then(async (r) => { if (r.ok) setGitTags(await r.json() as typeof gitTags); })
      .catch(() => setGitTags([]));
  }, [explorerOpen, filesData, gitTags]);

  const stepsTotal = Array.isArray(s.steps) ? s.steps.length : 0;
  const dateStr = s.completed_at
    ? new Date(s.completed_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date(s.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const totalCost = (runs ?? []).reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

  // Sprint-level aggregated metrics
  const sprintMetrics = React.useMemo(() => {
    if (!runs || runs.length === 0) return null;
    let totalWallMs = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalStorageBytes = 0;
    let peakHeapMb = 0;
    let agentCount = 0;

    for (const r of runs) {
      agentCount++;
      totalStorageBytes += r.output_size_bytes ?? 0;
      totalTokensIn += r.tokens_in ?? r.metrics?.tokens_in ?? 0;
      totalTokensOut += r.tokens_out ?? r.metrics?.tokens_out ?? 0;
      if (r.metrics?.heap_peak_mb && r.metrics.heap_peak_mb > peakHeapMb) {
        peakHeapMb = r.metrics.heap_peak_mb;
      }
      if (r.metrics?.wall_ms) {
        totalWallMs += r.metrics.wall_ms;
      } else if (r.started_at && r.finished_at) {
        totalWallMs += new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
      }
    }

    const starts = runs.filter(r => r.started_at).map(r => new Date(r.started_at!).getTime());
    const ends   = runs.filter(r => r.finished_at).map(r => new Date(r.finished_at!).getTime());
    const sprintElapsedMs = starts.length && ends.length
      ? Math.max(...ends) - Math.min(...starts)
      : 0;

    return { agentCount, sprintElapsedMs, totalWallMs, totalTokensIn, totalTokensOut, totalStorageBytes, peakHeapMb };
  }, [runs]);

  const ACTIVE_SPRINT_STATUSES = new Set(["running", "executing", "provisioning", "paused", "waiting", "queued"]);
  const isForceCompleted = s.status === "completed" && s.sprint_completed_saved === null && s.sprint_completed_saved !== false;
  const isInterrupted    = ACTIVE_SPRINT_STATUSES.has(s.status) && projectStatus === "completed";
  const displayStatus    = isInterrupted ? "interrupted" : s.status;

  return (
    <div style={{ borderTop: "1px solid var(--surface0)" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <button
          onClick={toggle}
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            padding: "8px 16px", background: "none", border: "none",
            cursor: "pointer", textAlign: "left", fontFamily: "var(--font-sans)",
          }}
        >
          <span style={{ color: "var(--overlay0)", flexShrink: 0 }}>
            {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, minWidth: 60, flexShrink: 0, color: "var(--text)" }}>
            Sprint {s.sprint_num}
          </span>

          {isInterrupted ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 8px", borderRadius: 99, background: "rgba(245,159,0,0.12)", color: "#f59f00" }}>
              interrupted
            </span>
          ) : (
            <StatusBadge status={displayStatus} />
          )}

          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, fontWeight: 700, textTransform: "uppercase", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3,
            background: storageBackend === "local" ? "rgba(166,227,161,0.12)" : "rgba(20,99,255,0.10)",
            color: storageBackend === "local" ? "var(--green)" : "var(--blue)",
          }}>
            {storageBackend === "local" ? <><FolderOpen size={8} /> local</> : <><Cloud size={8} /> cloud</>}
          </span>

          {isForceCompleted && (
            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "rgba(107,122,158,0.15)", color: "var(--overlay0)", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
              manual
            </span>
          )}
          {s.sprint_completed_saved === true && (
            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "rgba(64,160,43,0.12)", color: "var(--green, #40a02b)", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
              saved
            </span>
          )}
          {s.sprint_completed_saved === false && s.status === "completed" && (
            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "rgba(107,122,158,0.12)", color: "var(--overlay0)", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
              discarded
            </span>
          )}

          {s.tap_status !== "pending" && (
            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: s.tap_status === "approved" ? "rgba(0,196,168,0.15)" : "rgba(228,75,95,0.15)", color: s.tap_status === "approved" ? "var(--teal)" : "var(--red)", fontWeight: 700, textTransform: "uppercase", flexShrink: 0 }}>
              TAP {s.tap_status}
            </span>
          )}

          {stepsTotal > 0 && (
            <span style={{ fontSize: 10, color: "var(--overlay0)", flexShrink: 0 }}>{stepsTotal} steps</span>
          )}
          {s.repo_tag && (
            <span style={{ fontSize: 10, color: sc, fontWeight: 600, flexShrink: 0 }}>{s.repo_tag}</span>
          )}
          {s.commit_sha && (
            <code style={{ fontSize: 9, color: "var(--overlay0)", background: "var(--surface0)", padding: "1px 4px", borderRadius: 3, flexShrink: 0 }}>
              {s.commit_sha.slice(0, 7)}
            </code>
          )}
          {s.trigger_run_id && (
            <a href={`https://cloud.trigger.dev/runs/${s.trigger_run_id}`} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 9, color: "var(--blue)", textDecoration: "none", display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
              trigger <ExternalLink size={8} />
            </a>
          )}
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--overlay0)", marginLeft: "auto", flexShrink: 0 }}>
            {s.completed_at && s.started_at && (
              <span style={{ color: "var(--subtext0)", fontFamily: "var(--font-mono)" }} title="Sprint elapsed time">
                {fmtDuration(new Date(s.completed_at).getTime() - new Date(s.started_at).getTime())}
              </span>
            )}
            {dateStr}
            {runs !== null && totalCost > 0 && (
              <span style={{ color: "var(--subtext0)" }}>${totalCost.toFixed(4)}</span>
            )}
          </span>
        </button>

        <button
          onClick={openExplorer}
          title={storageBackend === "local" ? "Browse local artifacts" : "Browse cloud artifacts"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, margin: "0 4px 0 8px", borderRadius: 6,
            border: "none", background: explorerOpen ? "rgba(0,194,168,0.15)" : "none",
            color: explorerOpen ? "var(--teal, #00c2a8)" : "var(--overlay0)",
            cursor: "pointer", flexShrink: 0,
          }}
        >
          {storageBackend === "local" ? <FolderOpen size={13} /> : <Cloud size={13} />}
        </button>

        {session && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download sprint artifacts as ZIP"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, marginRight: 8, borderRadius: 6,
              border: "none", background: "none",
              color: downloading ? "var(--teal, #00c2a8)" : "var(--overlay0)",
              cursor: downloading ? "wait" : "pointer", flexShrink: 0,
            }}
          >
            <Download size={13} />
          </button>
        )}

        {session && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const expected = `sprint-${s.sprint_num}`;
              const input = prompt(`Type "${expected}" to confirm deletion of this sprint and all its artifacts:`);
              if (input !== expected) return;
              try {
                const res = await fetch(`/api/projects/${projectId}/sprints/${s.id}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${session.access_token}` },
                });
                if (res.ok) window.location.reload();
                else console.error("Delete failed", await res.text());
              } catch (err) {
                console.error("Delete error", err);
              }
            }}
            title="Delete sprint and artifacts"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, marginRight: 4, borderRadius: 6,
              border: "none", background: "none",
              color: "var(--overlay0)", cursor: "pointer", flexShrink: 0,
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Storage Explorer */}
      {explorerOpen && (
        <div style={{ borderTop: "1px solid var(--surface1)", background: "var(--base)", padding: "10px 16px" }}>
          {filesLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--overlay0)" }}>
              <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Loading…
            </div>
          )}
          {filesData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filesData.artifacts.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--overlay0)", marginBottom: 5 }}>
                    Artifacts ({filesData.artifacts.length})
                  </div>
                  {filesData.artifacts.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", borderBottom: "1px solid var(--surface0)" }}>
                      <FileText size={10} color="var(--teal)" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                        {a.outputRef.split("/").pop()}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--overlay0)", flexShrink: 0 }}>{a.agent}</span>
                    </div>
                  ))}
                </div>
              )}
              {filesData.artifacts.length === 0 && (
                <span style={{ fontSize: 11, color: "var(--overlay0)" }}>No artifacts for this sprint.</span>
              )}

              {filesData.storageBackend !== "unavailable" && filesData.storageFiles.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--overlay0)", marginBottom: 5 }}>
                    {filesData.storageBackend === "local" ? "Local Files" : "Cloud Storage"} ({filesData.storageFiles.length})
                  </div>
                  <div style={{ maxHeight: 160, overflowY: "auto" }}>
                    {filesData.storageFiles.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", borderBottom: "1px solid var(--surface0)" }}>
                        <FileText size={9} color="var(--overlay0)" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 9, color: "var(--subtext0)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                          {f.path}
                        </span>
                        {f.size !== null && (
                          <span style={{ fontSize: 9, color: "var(--overlay0)", flexShrink: 0 }}>
                            {f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}KB`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filesData.gitInfo && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--overlay0)", marginBottom: 5, display: "flex", alignItems: "center", gap: 4 }}>
                    <GitBranch size={10} /> Repository
                  </div>
                  <a href={filesData.gitInfo.repoUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 10, color: "var(--blue)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 5 }}>
                    {filesData.gitInfo.repoUrl.replace("https://github.com/", "")} <ExternalLink size={9} />
                  </a>
                  {gitTags === null && <span style={{ fontSize: 10, color: "var(--overlay0)" }}>Loading tags…</span>}
                  {gitTags && gitTags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {gitTags.slice(0, 6).map((t) => (
                        <span key={t.name} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "rgba(20,99,255,0.1)", color: "var(--blue)", fontFamily: "var(--font-mono)" }}>
                          {t.name}
                        </span>
                      ))}
                      {gitTags.length > 6 && <span style={{ fontSize: 9, color: "var(--overlay0)" }}>+{gitTags.length - 6} more</span>}
                    </div>
                  )}
                  {gitTags?.length === 0 && <span style={{ fontSize: 10, color: "var(--overlay0)" }}>No tags found.</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Briefing */}
      {open && s.briefing && (
        <div style={{ padding: "0 16px 6px 34px", fontSize: 10, color: "var(--subtext0)", fontStyle: "italic" }}>
          {s.briefing.length > 120 ? s.briefing.slice(0, 120) + "…" : s.briefing}
        </div>
      )}

      {/* Sprint observability summary */}
      {open && sprintMetrics && sprintMetrics.agentCount > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 16px 4px 34px",
          borderTop: "1px solid var(--surface0)",
        }}>
          {sprintMetrics.sprintElapsedMs > 0 && (
            <MetricChip icon={<Timer size={9} />} label="elapsed" value={fmtDuration(sprintMetrics.sprintElapsedMs)}
              title={`Total sprint wall-clock: ${fmtDuration(sprintMetrics.sprintElapsedMs)} | Agent compute: ${fmtDuration(sprintMetrics.totalWallMs)}`} />
          )}
          {(sprintMetrics.totalTokensIn + sprintMetrics.totalTokensOut) > 0 && (
            <MetricChip icon={<Brain size={9} />} label="tokens"
              value={`${fmtTokens(sprintMetrics.totalTokensIn)} in / ${fmtTokens(sprintMetrics.totalTokensOut)} out`}
              title={`Input: ${sprintMetrics.totalTokensIn.toLocaleString()} | Output: ${sprintMetrics.totalTokensOut.toLocaleString()}`} />
          )}
          {totalCost > 0 && (
            <MetricChip icon={<Coins size={9} />} label="cost" value={`$${totalCost.toFixed(4)}`} />
          )}
          {sprintMetrics.totalStorageBytes > 0 && (
            <MetricChip icon={<HardDrive size={9} />} label="storage" value={fmtBytes(sprintMetrics.totalStorageBytes)}
              title={`Total artifact storage across ${sprintMetrics.agentCount} agents`} />
          )}
          {sprintMetrics.peakHeapMb > 0 && (
            <MetricChip icon={<Cpu size={9} />} label="peak mem" value={`${sprintMetrics.peakHeapMb} MB`}
              title="Peak heap memory across all agent runs in this sprint" />
          )}
        </div>
      )}

      {/* Agent runs */}
      {open && (
        <div style={{ padding: "0 16px 10px 34px" }}>
          {loadingRuns && (
            <div style={{ fontSize: 10, color: "var(--overlay0)" }}>Loading runs…</div>
          )}
          {!loadingRuns && runs !== null && runs.length === 0 && (
            <div style={{ fontSize: 10, color: "var(--overlay0)" }}>No agent runs recorded.</div>
          )}
          {!loadingRuns && runs !== null && runs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {runs.map((r) => {
                const statusColor = r.status === "done" ? "var(--green)" : r.status === "failed" ? "var(--red)" : r.status === "running" ? "var(--blue)" : "var(--overlay0)";
                const m = r.metrics;
                const wallMs = m?.wall_ms ?? (r.started_at && r.finished_at
                  ? new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()
                  : null);
                const tokIn  = r.tokens_in ?? m?.tokens_in ?? 0;
                const tokOut = r.tokens_out ?? m?.tokens_out ?? 0;
                return (
                  <div key={r.id} style={{ padding: "4px 0", borderBottom: "1px solid var(--surface0)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                      {r.step !== null && (
                        <span style={{ color: "var(--overlay0)", flexShrink: 0, minWidth: 20 }}>#{r.step}</span>
                      )}
                      <span style={{ color: "var(--text)", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.agent}
                      </span>
                      {r.run_type === "run-once" && (
                        <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: "rgba(223,142,29,0.15)", color: "var(--yellow, #df8e1d)", fontWeight: 600, flexShrink: 0 }}>
                          once
                        </span>
                      )}
                      {m?.model && (
                        <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "var(--surface0)", color: "var(--overlay0)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                          {m.model}
                        </span>
                      )}
                      {wallMs !== null && (
                        <span style={{ color: "var(--overlay0)", flexShrink: 0, fontSize: 9, fontFamily: "var(--font-mono)" }}>
                          {fmtDuration(wallMs)}
                        </span>
                      )}
                      {r.cost_usd > 0 && (
                        <span style={{ color: "var(--overlay0)", fontFamily: "var(--font-mono)", flexShrink: 0, fontSize: 9 }}>
                          ${r.cost_usd.toFixed(4)}
                        </span>
                      )}
                    </div>
                    {(m || (tokIn + tokOut) > 0 || (r.output_size_bytes ?? 0) > 0) && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2, paddingLeft: 12 }}>
                        {(tokIn + tokOut) > 0 && (
                          <MetricChip icon={<Brain size={8} />} value={`${fmtTokens(tokIn)}/${fmtTokens(tokOut)}`}
                            title={`Tokens in: ${tokIn.toLocaleString()} | out: ${tokOut.toLocaleString()}`} />
                        )}
                        {m?.llm_ms && wallMs ? (
                          <MetricChip icon={<Timer size={8} />} label="LLM"
                            value={`${fmtDuration(m.llm_ms)} (${Math.round(m.llm_ms / wallMs * 100)}%)`}
                            title={`LLM processing: ${fmtDuration(m.llm_ms)} of ${fmtDuration(wallMs)} total`} />
                        ) : null}
                        {m?.heap_peak_mb ? (
                          <MetricChip icon={<Cpu size={8} />}
                            value={`${m.heap_peak_mb} MB`}
                            title={`Heap: ${m.heap_start_mb ?? "?"}→${m.heap_peak_mb}→${m.heap_end_mb ?? "?"} MB`}
                            color={m.heap_peak_mb > 500 ? "var(--red)" : undefined} />
                        ) : null}
                        {(r.output_size_bytes ?? 0) > 0 && (
                          <MetricChip icon={<HardDrive size={8} />} value={fmtBytes(r.output_size_bytes!)}
                            title={`Artifact storage: ${fmtBytes(r.output_size_bytes!)}${m?.artifact_count ? ` (${m.artifact_count} files)` : ""}`} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {(totalCost > 0 || (sprintMetrics?.totalStorageBytes ?? 0) > 0) && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4, marginTop: 2 }}>
                  {(sprintMetrics?.totalStorageBytes ?? 0) > 0 && (
                    <span style={{ fontSize: 9, color: "var(--overlay0)", fontFamily: "var(--font-mono)" }}>
                      storage {fmtBytes(sprintMetrics!.totalStorageBytes)}
                    </span>
                  )}
                  {totalCost > 0 && (
                    <span style={{ fontSize: 10, color: "var(--subtext0)", fontFamily: "var(--font-mono)" }}>
                      total ${totalCost.toFixed(4)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Project Card ──────────────────────────────────────────────────────────── */

export type ProjectCardMode = "studio" | "office";

export function ProjectCard({ project, mode = "studio", onDelete, onToggleLock, onEditSettings }: {
  project: Project;
  mode?: ProjectCardMode;
  onDelete?: (p: Project) => void;
  onToggleLock?: (p: Project) => void;
  onEditSettings?: (p: Project) => void;
}) {
  const color = STATUS_COLOR[project.status] ?? "#6b7a9e";
  const isActive = ACTIVE_STATUSES.includes(project.status as string);
  const inPipeline = QUEUE_STATUSES.has(project.status as string);
  const canDelete = !project.locked && !isActive;
  const isStudio = mode === "studio";

  const [sprintsOpen, setSprintsOpen] = useState(false);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loadingSprints, setLoadingSprints] = useState(false);

  function toggleSprints() {
    if (!sprintsOpen && sprints.length === 0 && !loadingSprints) {
      setLoadingSprints(true);
      supabase.from("sprints").select("*")
        .eq("project_id", project.id)
        .order("sprint_num", { ascending: false })
        .then(({ data }) => {
          if (data) setSprints(data as Sprint[]);
          setLoadingSprints(false);
        });
    }
    setSprintsOpen((o) => !o);
  }

  return (
    <div style={{
      background: "var(--surface0)", border: "1px solid var(--surface1)",
      borderLeft: `3px solid ${project.locked ? "var(--overlay0)" : inPipeline ? color : "var(--surface1)"}`,
      borderRadius: 12, overflow: "hidden",
      opacity: project.locked ? 0.75 : 1, marginBottom: 10,
    }}>
      {/* Main area */}
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {project.locked && <Lock size={10} color="var(--overlay0)" />}
              <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</div>
            </div>
            <code style={{ fontSize: 10, color: "var(--overlay0)" }}>{project.slug}</code>
          </div>
          {inPipeline && (
            <div style={{ flexShrink: 0 }}>
              <StatusBadge status={project.status as string} />
            </div>
          )}
        </div>

        {project.intake_brief && (
          <p style={{ fontSize: 11, color: "var(--subtext0)", margin: "0 0 8px", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>
            {project.intake_brief}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "var(--surface1)", color: "var(--overlay0)", textTransform: "uppercase", fontWeight: 600 }}>
            {project.mode ?? ""}
          </span>
          <span style={{ fontSize: 10, color: "var(--overlay0)" }}>{new Date(project.updated_at).toLocaleDateString()}</span>
          <div style={{ flex: 1 }} />
          {isStudio && onEditSettings && (
            <IconBtn title="Project settings" color="var(--overlay0)" bg="transparent" onClick={(e) => { e.stopPropagation(); onEditSettings(project); }}>
              <Settings size={11} />
            </IconBtn>
          )}
          {isStudio && onToggleLock && (
            <IconBtn title={project.locked ? "Unlock project" : "Lock project"} color={project.locked ? "var(--yellow)" : "var(--overlay0)"} bg="transparent" onClick={(e) => { e.stopPropagation(); onToggleLock(project); }}>
              {project.locked ? <Lock size={11} /> : <Unlock size={11} />}
            </IconBtn>
          )}
          {isStudio && onDelete && (
            <IconBtn
              title={project.locked ? "Unlock to delete" : isActive ? "Active in pipeline" : "Delete project"}
              color={canDelete ? "var(--red)" : "var(--surface2)"} bg="transparent"
              onClick={(e) => { e.stopPropagation(); onDelete(project); }}
              disabled={!canDelete}
            >
              <Trash2 size={11} />
            </IconBtn>
          )}
        </div>
      </div>

      {/* Sprint history toggle */}
      <button
        onClick={toggleSprints}
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
          {project.sprint_count ?? 0} sprint{(project.sprint_count ?? 0) !== 1 ? "s" : ""}
        </span>
        {loadingSprints
          ? <RefreshCw size={10} style={{ animation: "spin 1s linear infinite" }} />
          : sprintsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      {/* Sprint list */}
      {sprintsOpen && (
        <div style={{ background: "var(--crust)" }}>
          {sprints.length === 0 && !loadingSprints ? (
            <div style={{ padding: "10px 16px", fontSize: 11, color: "var(--overlay0)" }}>No sprints yet.</div>
          ) : (
            sprints.map((s) => (
              <SprintRow
                key={s.id}
                sprint={s}
                projectId={project.id}
                projectSlug={project.slug}
                projectStatus={project.status}
                storageBackend={(project.settings?.storage_backend_type as "supabase" | "local" | undefined) ?? "supabase"}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
