"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Zap, GitBranch, FolderOpen, Clock, CheckCircle2,
  XCircle, AlertTriangle, X, Terminal, ExternalLink,
  Sparkles, Search, RefreshCw, Settings,
  ChevronDown, Loader2,
  HelpCircle, Brain, Save,
} from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { ProjectCard, StatusBadge, type Project, type Sprint } from "@/components/ProjectCard";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { brand } from "@/lib/brand";

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface Pipeline {
  id: string; slug: string; name: string; description: string | null;
  type: "system" | "custom"; steps: unknown[];
}

const ACTIVE_STATUSES = ["executing", "running", "provisioning", "queued"];
const QUEUE_STATUSES = new Set(["queued", "executing", "running", "waiting", "paused", "provisioning"]);

/* ── Shared styles ──────────────────────────────────────────────────────────── */

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

/* ── New Project Modal ──────────────────────────────────────────────────────── */

function toProjectSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function NewProjectModal({
  factoryId, factorySlug, onClose, onCreated, onOpenSettings, inline,
}: {
  factoryId: string;
  factorySlug: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
  onOpenSettings?: (project: Project) => void;
  inline?: boolean;
}) {
  const [name,           setName]           = useState("");
  const [brief,          setBrief]          = useState("");
  const [mode,           setMode]           = useState<"new" | "adopt">("new");
  const [repoUrl,        setRepoUrl]        = useState("");
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const { session } = useAuth();

  async function handleCreate() {
    if (!name.trim() || !brief.trim()) { setError("Name and brief are required."); return; }
    setSaving(true); setError(null);
    if (!session) return;

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ factoryId, name, intake_brief: brief, pipeline_id: null, mode, repo_url: repoUrl || null }),
    });
    const body = await res.json() as { project?: Project; error?: string };
    if (!res.ok) { setError(body.error ?? "Failed to create project."); setSaving(false); return; }

    const project = body.project!;
    setSaving(false);
    onCreated(project);
    onOpenSettings?.(project);
  }

  return (
    <div style={inline
      ? { flex: 1, overflowY: "auto", background: "var(--mantle)" }
      : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }
    }>
      <div style={inline ? {} : { background: "var(--mantle)", border: "1px solid var(--surface0)", borderRadius: 18, width: "min(620px, 95vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--surface0)", position: "sticky", top: 0, background: "var(--mantle)", zIndex: 10 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>New Project</div>
            <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2 }}>The Intake agent will receive your brief and kick off the pipeline</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={handleCreate} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: "none", background: "var(--blue)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: "var(--font-sans)" }}>
              {saving ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={12} />}
              Create
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--overlay0)", padding: 4 }}><X size={18} /></button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Mode */}
          <div>
            <label style={labelStyle}>Mode</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {([
                { id: "new",   label: "New project",     desc: "Start from a brief or idea" },
                { id: "adopt", label: "Adopt existing",  desc: "Factory takes over an existing project" },
              ] as const).map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)} style={{
                  textAlign: "left", padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                  border: `1.5px solid ${mode === m.id ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                  background: mode === m.id ? "rgba(20,99,255,0.08)" : "var(--surface0)",
                  fontFamily: "var(--font-sans)",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: mode === m.id ? "#1463ff" : "var(--text)", marginBottom: 3 }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: "var(--subtext0)" }}>{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Project name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Mobile App" style={inputStyle} autoFocus />
            {name.trim() && (
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <GitBranch size={11} color="var(--overlay0)" />
                <span style={{ fontSize: 11, color: "var(--overlay0)" }}>GitHub repo:</span>
                <code style={{ fontSize: 11, color: "var(--teal)", fontFamily: "var(--font-mono)" }}>
                  {factorySlug ? `${factorySlug}-${toProjectSlug(name)}` : toProjectSlug(name)}
                </code>
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>
              {mode === "new" ? "Brief / spec" : "What to adopt"}
              <span style={{ fontWeight: 400, color: "var(--overlay0)", marginLeft: 6 }}>
                {mode === "new" ? "— one sentence or a full spec" : "— repo URL + description of the project"}
              </span>
            </label>
            <textarea
              value={brief} onChange={(e) => setBrief(e.target.value)}
              placeholder={mode === "new"
                ? "A meal planning app for busy parents that suggests weekly menus based on dietary preferences and automatically generates a shopping list."
                : "https://github.com/org/repo — A React Native app that tracks habits. We need to add AI-powered suggestions and fix the authentication flow."}
              rows={5}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </div>

          {mode === "adopt" && (
            <div>
              <label style={labelStyle}>Repository URL <span style={{ fontWeight: 400 }}>(optional)</span></label>
              <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/org/repo" style={inputStyle} />
            </div>
          )}

          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(228,75,95,0.1)", border: "1px solid rgba(228,75,95,0.3)", color: "var(--red)", fontSize: 13 }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}
        </div>

        {/* Footer — modal mode only */}
        {!inline && (
          <div style={{ padding: "12px 22px", borderTop: "1px solid var(--surface0)", display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 9, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 13, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Cancel</button>
            <button onClick={handleCreate} disabled={saving} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "9px", borderRadius: 9, border: "none", background: "#1463ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "var(--font-sans)" }}>
              {saving ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Creating…</> : <><Sparkles size={13} /> Create Project</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface LiveProvider { id: string; models: { id: string; name: string }[] }

// Placeholder — RunSprintModal removed; Start Sprint is now in the Pipelines view.
// Keeping LiveProvider here as it is still used by ProjectSettingsModal.

/* ── Project Settings Modal ─────────────────────────────────────────────── */

type FocusMode = "speed" | "balanced" | "quality";
type OnRejection = "retry_once" | "end_sprint" | "request_instructions" | "skip";

type SupportedCli = "claude-code" | "aider" | "codex" | "plandex" | "goose" | "amp" | "gemini-cli";
type CliStorageBackend = "supabase" | "local";

interface CliAgentOverride {
  enabled: boolean;
  cli: SupportedCli;
  authMode?: "api-key" | "oauth";
  model?: string;
  timeout_secs?: number;
  max_turns?: number;
  open_pr?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  append_system_prompt?: string;
}

interface CliAgentsConfig {
  enabled?: boolean;
  /** @deprecated use execution_backend */
  execution_mode?: "cloud" | "local";
  execution_backend?: CliStorageBackend;
  local_base_path?: string;

  mcp_enabled?: boolean;
  hooks_enabled?: boolean;
  default_max_turns?: number;
  default_cli?: SupportedCli;
  agent_overrides?: Record<string, CliAgentOverride>;
}

type OutputDestination = "github" | "download" | "discard";

interface ProjectSettings {
  focus?: FocusMode;
  planning_provider?: string; planning_model?: string;
  dev_provider?: string; dev_model?: string;
  governance_provider?: string; governance_model?: string;
  default_provider?: string; default_model?: string;
  budget_usd?: number;
  timeout_agent_ms?: number;
  guidelines?: string;
  on_rejection?: OnRejection;
  detailed_monitoring?: boolean;
  use_dna?: boolean;
  output_destination?: OutputDestination;
  github_branch?: string;
  cli_agents?: CliAgentsConfig;
  agent_configs?: Record<string, {
    provider?: string; model?: string;
    max_tool_rounds?: number; timeout_ms?: number;
    max_tokens?: number; guidelines?: string;
  }>;
  [key: string]: unknown;
}

// ── Provider / model catalogue (dynamic) ─────────────────────────────────────

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google",
  mistral: "Mistral", perplexity: "Perplexity", xai: "xAI",
  zai: "zAI (01.AI)", deepseek: "DeepSeek", qwen: "Qwen", moonshot: "Moonshot AI",
};

function ProviderSelect({ value, onChange, style, providers }: {
  value: string; onChange: (v: string) => void; style?: React.CSSProperties; providers: LiveProvider[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      <option value="">— not set (per-agent default)</option>
      {providers.map((p) => (
        <option key={p.id} value={p.id}>{PROVIDER_DISPLAY[p.id] ?? p.id}</option>
      ))}
    </select>
  );
}

function ModelSelect({ provider, value, onChange, style, providers }: {
  provider: string; value: string; onChange: (v: string) => void; style?: React.CSSProperties; providers: LiveProvider[];
}) {
  const models = providers.find((p) => p.id === provider)?.models ?? [];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={style} disabled={!provider}>
      <option value="">— not set (per-agent default)</option>
      {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
    </select>
  );
}

// ── Per-agent config row ──────────────────────────────────────────────────────

type AgentCfgRow = {
  disabled: boolean;
  provider: string; model: string;
  max_tool_rounds: string; timeout_ms: string; max_tokens: string;
  guidelines: string;
};

function emptyAgentCfg(): AgentCfgRow {
  return { disabled: false, provider: "", model: "", max_tool_rounds: "", timeout_ms: "", max_tokens: "", guidelines: "" };
}

function agentCfgFromSaved(saved?: { disabled?: boolean; provider?: string; model?: string; max_tool_rounds?: number; timeout_ms?: number; max_tokens?: number; guidelines?: string }): AgentCfgRow {
  if (!saved) return emptyAgentCfg();
  return {
    disabled:        saved.disabled ?? false,
    provider:        saved.provider ?? "",
    model:           saved.model ?? "",
    max_tool_rounds: saved.max_tool_rounds !== undefined ? String(saved.max_tool_rounds) : "",
    timeout_ms:      saved.timeout_ms !== undefined ? String(saved.timeout_ms) : "",
    max_tokens:      saved.max_tokens !== undefined ? String(saved.max_tokens) : "",
    guidelines:      saved.guidelines ?? "",
  };
}

function hasOverrides(cfg: AgentCfgRow): boolean {
  return cfg.provider !== "" || cfg.model !== "" || cfg.max_tool_rounds !== "" ||
    cfg.timeout_ms !== "" || cfg.max_tokens !== "" || cfg.guidelines !== "";
}

function SectionHeader({ id, title, icon, collapsed, onToggle, badge }: {
  id: string; title: string; icon: React.ReactNode; collapsed: boolean;
  onToggle: () => void; badge?: React.ReactNode;
}) {
  return (
    <button onClick={onToggle} type="button" style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%",
      padding: "10px 0", background: "none", border: "none", cursor: "pointer",
      borderBottom: "1px solid var(--surface0)", marginBottom: collapsed ? 0 : 12,
      fontFamily: "var(--font-sans)",
    }}>
      {icon}
      <span style={{ flex: 1, textAlign: "left", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{title}</span>
      {badge}
      <ChevronDown size={14} style={{ color: "var(--overlay0)", transform: collapsed ? "rotate(-90deg)" : "none", transition: "0.15s" }} />
    </button>
  );
}

function ProjectSettingsModal({ project, pipelines, onClose, onSaved, inline }: {
  project: Project & { settings?: ProjectSettings };
  pipelines: Pipeline[];
  onClose: () => void;
  onSaved: (updated: Project) => void;
  inline?: boolean;
}) {
  const s = project.settings ?? {};

  // ── Collapsible sections ──────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    pipeline: true, orchestration: true, cli: true, agents: true,
    cag: true, rag: true, llm: true, budget: true, monitoring: true, github: true,
  });
  const toggleSection = (sec: string) => setCollapsed((p) => ({ ...p, [sec]: !p[sec] }));

  // ── Briefing ──────────────────────────────────────────────────────────
  const [briefing, setBriefing] = useState(project.intake_brief ?? "");

  // ── Pipeline ───────────────────────────────────────────────────────────
  const [pipelineId, setPipelineId] = useState(project.pipeline_id ?? "");

  // Agents available in the selected pipeline
  const pipelineAgents = React.useMemo<string[]>(() => {
    const pl = pipelines.find((p) => p.id === pipelineId);
    if (!pl) return [];
    return [...new Set((pl.steps as { agent: string }[]).map((st) => st.agent))];
  }, [pipelines, pipelineId]);

  // ── Live providers ─────────────────────────────────────────────────────
  const [liveProviders, setLiveProviders] = useState<LiveProvider[]>([]);
  const { session: authSession, tenantId, factoryName: ctxFactoryName } = useAuth();

  useEffect(() => {
    if (!authSession) return;
    fetch("/api/wizard/models", { headers: { Authorization: `Bearer ${authSession.access_token}` } })
      .then(async (res) => {
        if (res.ok) {
          const body = await res.json() as { providers: LiveProvider[] };
          setLiveProviders(body.providers ?? []);
        }
      });
  }, [authSession]);

  // ── Project-level state ────────────────────────────────────────────────
  const [focus,      setFocus]      = useState<FocusMode>(s.focus ?? "balanced");
  const [defProv,    setDefProv]    = useState(s.default_provider ?? "");
  const [defModel,   setDefModel]   = useState(s.default_model ?? "");
  const [planProv,   setPlanProv]   = useState(s.planning_provider ?? "");
  const [planModel,  setPlanModel]  = useState(s.planning_model ?? "");
  const [devProv,    setDevProv]    = useState(s.dev_provider ?? "");
  const [devModel,   setDevModel]   = useState(s.dev_model ?? "");
  const [govProv,    setGovProv]    = useState(s.governance_provider ?? "");
  const [govModel,   setGovModel]   = useState(s.governance_model ?? "");
  const [budget,     setBudget]     = useState(s.budget_usd !== undefined ? String(s.budget_usd) : "");
  const [timeout,    setTimeout_]   = useState(s.timeout_agent_ms !== undefined ? String(s.timeout_agent_ms) : "");
  const [guidelines, setGuidelines] = useState(s.guidelines ?? "");
  const [onReject,   setOnReject]   = useState<OnRejection>(s.on_rejection ?? "end_sprint");
  const [detailedMonitoring, setDetailedMonitoring] = useState(s.detailed_monitoring ?? false);
  const [useDna,             setUseDna]             = useState(s.use_dna ?? false);
  const [githubEnabled,      setGithubEnabled]      = useState(s.output_destination === "github");
  const [githubAutoPush,     setGithubAutoPush]     = useState(false);

  // ── Knowledge Base ────────────────────────────────────────────────────
  const [knowledgeInstances, setKnowledgeInstances] = useState<{ id: string; name: string; enabled: boolean; chunkCount: number }[]>([]);
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false);

  useEffect(() => {
    if (!authSession || !tenantId || knowledgeLoaded) return;
    const headers = { Authorization: `Bearer ${authSession.access_token}` };
    Promise.all([
      fetch(`/api/knowledge?tenantId=${tenantId}`, { headers }),
      fetch(`/api/projects/${project.id}/knowledge`, { headers }),
    ]).then(async ([allRes, linkedRes]) => {
      const allInstances: { id: string; name: string; enabled?: boolean; chunkCount: number }[] =
        allRes.ok ? ((await allRes.json()) as { instances: { id: string; name: string; chunkCount: number }[] }).instances ?? [] : [];
      const linkedInstances: { id: string; name: string; enabled?: boolean; chunkCount: number }[] =
        linkedRes.ok ? ((await linkedRes.json()) as { instances: { id: string; name: string; enabled?: boolean; chunkCount: number }[] }).instances ?? [] : [];
      const linkedIds = new Set(linkedInstances.filter((i) => i.enabled).map((i) => i.id));
      setKnowledgeInstances(allInstances.map((i) => ({ ...i, enabled: linkedIds.has(i.id) })));
    }).finally(() => setKnowledgeLoaded(true));
  }, [authSession, tenantId, project.id, knowledgeLoaded]);
  const [githubBranch,       setGithubBranch]       = useState(s.github_branch ?? "main");

  // ── Orchestration mode ──────────────────────────────────────────────────
  // Default to "local" for new/unconfigured projects. Existing projects keep
  // their saved choice (execution_backend === "supabase" means cloud).
  const [orchMode, setOrchMode] = useState<"local" | "cloud">(() => {
    if (!s.cli_agents) return "local";
    if (s.cli_agents.execution_backend === "local" || s.cli_agents.enabled) return "local";
    return "cloud";
  });

  // ── CLI Agents ─────────────────────────────────────────────────────────────
  const [cliEnabled,       setCliEnabled]       = useState(s.cli_agents?.enabled ?? false);
  const [cliBackend,       setCliBackend]       = useState<CliStorageBackend>(s.cli_agents?.execution_backend ?? "supabase");
  const [cliLocalBasePath, setCliLocalBasePath] = useState(s.cli_agents?.local_base_path ?? "");
  const [globalBasePath, setGlobalBasePath] = useState("");

  // Fetch global base path from storage settings (User Space default)
  useEffect(() => {
    if (!authSession) return;
    fetch("/api/settings/storage", { headers: { Authorization: `Bearer ${authSession.access_token}` } })
      .then(async (r) => {
        if (!r.ok) return;
        const body = await r.json() as { backends: { type: string; basePath?: string }[] };
        const local = body.backends?.find((b) => b.type === "local");
        if (local?.basePath) {
          setGlobalBasePath(local.basePath);
          // Pre-fill if project has no base path set
          if (!s.cli_agents?.local_base_path) {
            setCliLocalBasePath(local.basePath);
          }
        }
      })
      .catch(() => {});
  }, [authSession, s.cli_agents?.local_base_path]);
  const [gitStatus, setGitStatus] = useState<{ repoName?: string; repoUrl?: string | null; exists?: boolean | null } | null>(null);
  const [cliMcpEnabled,      setCliMcpEnabled]      = useState(s.cli_agents?.mcp_enabled !== false);
  const [cliHooksEnabled,    setCliHooksEnabled]    = useState(s.cli_agents?.hooks_enabled ?? false);
  const [cliDefaultMaxTurns, setCliDefaultMaxTurns] = useState(s.cli_agents?.default_max_turns ?? "");

  // Fetch git repo status when local backend is selected
  useEffect(() => {
    if (!authSession || cliBackend !== "local") { setGitStatus(null); return; }
    fetch(`/api/projects/${project.id}/git-status`, {
      headers: { Authorization: `Bearer ${authSession.access_token}` },
    }).then(async (res) => {
      if (res.ok) setGitStatus(await res.json() as { repoName?: string; repoUrl?: string | null; exists?: boolean | null });
    }).catch(() => setGitStatus(null));
  }, [authSession, cliBackend, project.id]);
  const [cliDefaultCli,    setCliDefaultCli]    = useState<SupportedCli | "">(s.cli_agents?.default_cli ?? "");
  const [cliOverrides,     setCliOverrides]     = useState<Record<string, CliAgentOverride>>(
    s.cli_agents?.agent_overrides ?? {},
  );
  const [expandedCliAgent, setExpandedCliAgent] = useState<string | null>(null);

  function setCliAgentEnabled(agent: string, enabled: boolean) {
    setCliOverrides((prev) => {
      const existing = prev[agent];
      const cli = existing?.cli || cliDefaultCli || "claude-code" as SupportedCli;
      if (!enabled) {
        const next = { ...prev };
        delete next[agent];
        return next;
      }
      return { ...prev, [agent]: { ...(existing ?? {}), enabled: true, cli } };
    });
  }

  function setCliAgentField<K extends keyof CliAgentOverride>(agent: string, field: K, value: CliAgentOverride[K]) {
    setCliOverrides((prev) => ({
      ...prev,
      [agent]: { ...(prev[agent] ?? { enabled: true, cli: (cliDefaultCli || "claude-code") as SupportedCli }), [field]: value },
    }));
  }

  function applyAutoConfig(f: FocusMode) {
    setFocus(f);
  }

  // ── Per-agent fine-tuning state ────────────────────────────────────────
  const allAgentNames = React.useMemo(() => {
    const saved = Object.keys(s.agent_configs ?? {});
    return [...new Set([...pipelineAgents, ...saved])];
  }, [pipelineAgents, s.agent_configs]);

  const [agentCfgs, setAgentCfgs] = useState<Record<string, AgentCfgRow>>(() => {
    const init: Record<string, AgentCfgRow> = {};
    for (const a of allAgentNames) {
      init[a] = agentCfgFromSaved((s.agent_configs ?? {})[a]);
    }
    return init;
  });
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // When pipeline changes, ensure all pipeline agents appear in the table
  useEffect(() => {
    setAgentCfgs((prev) => {
      const next = { ...prev };
      for (const a of pipelineAgents) {
        if (!next[a]) next[a] = emptyAgentCfg();
      }
      return next;
    });
  }, [pipelineAgents]);

  function setAgentField(agent: string, field: keyof AgentCfgRow, value: string | boolean) {
    setAgentCfgs((prev) => ({ ...prev, [agent]: { ...(prev[agent] ?? emptyAgentCfg()), [field]: value } }));
  }

  function removeAgent(name: string) {
    setAgentCfgs((prev) => { const next = { ...prev }; delete next[name]; return next; });
    if (expandedAgent === name) setExpandedAgent(null);
  }

  // ── UI helpers ─────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const ss: React.CSSProperties = { ...inputStyle, padding: "6px 10px", height: 32 };
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };
  const divider: React.CSSProperties = { borderTop: "1px solid var(--surface0)", margin: "14px 0" };

  function ProvRow({ label, prov, setProv, model, setModel }: {
    label: string;
    prov: string; setProv: (v: string) => void;
    model: string; setModel: (v: string) => void;
  }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 90, fontSize: 11, color: "var(--subtext0)", flexShrink: 0 }}>{label}</div>
        <ProviderSelect value={prov} onChange={(v) => { setProv(v); setModel(""); }} style={{ ...ss, flex: "0 0 160px" }} providers={liveProviders} />
        <ModelSelect provider={prov} value={model} onChange={setModel} style={{ ...ss, flex: 1 }} providers={liveProviders} />
      </div>
    );
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setError(null);
    if (!authSession) return;
    const session = authSession;

    const agent_configs: ProjectSettings["agent_configs"] = {};
    for (const [agent, cfg] of Object.entries(agentCfgs)) {
      // Store even if disabled so the values are preserved
      if (!hasOverrides(cfg) && !cfg.disabled) continue;
      agent_configs[agent] = {
        ...(cfg.disabled                                  ? { disabled: true } : {}),
        ...(cfg.provider        ? { provider: cfg.provider } : {}),
        ...(cfg.model           ? { model: cfg.model } : {}),
        ...(cfg.max_tool_rounds ? { max_tool_rounds: parseInt(cfg.max_tool_rounds, 10) } : {}),
        ...(cfg.timeout_ms      ? { timeout_ms: parseInt(cfg.timeout_ms, 10) } : {}),
        ...(cfg.max_tokens      ? { max_tokens: parseInt(cfg.max_tokens, 10) } : {}),
        ...(cfg.guidelines      ? { guidelines: cfg.guidelines } : {}),
      };
    }

    const enabledOverrides = Object.fromEntries(
      Object.entries(cliOverrides).filter(([, v]) => v.enabled),
    );

    // Always save cli_agents with execution_backend so orchestration mode persists
    const cliAgentsCfg: CliAgentsConfig = {
      enabled: cliEnabled,
      execution_backend: orchMode === "local" ? "local" : "supabase",
      ...(orchMode === "local" ? { local_base_path: cliLocalBasePath || globalBasePath || "" } : {}),
      ...(cliEnabled ? {
        mcp_enabled: cliMcpEnabled,
        hooks_enabled: cliHooksEnabled,
        ...(cliDefaultMaxTurns ? { default_max_turns: Number(cliDefaultMaxTurns) } : { default_max_turns: 1 }),
        ...(cliDefaultCli ? { default_cli: cliDefaultCli } : {}),
        ...(Object.keys(enabledOverrides).length > 0 ? { agent_overrides: enabledOverrides } : {}),
      } : {}),
    };

    const settings: ProjectSettings = {
      focus,
      on_rejection: onReject,
      ...(defProv    ? { default_provider: defProv } : {}),
      ...(defModel   ? { default_model: defModel } : {}),
      ...(planProv   ? { planning_provider: planProv } : {}),
      ...(planModel  ? { planning_model: planModel } : {}),
      ...(devProv    ? { dev_provider: devProv } : {}),
      ...(devModel   ? { dev_model: devModel } : {}),
      ...(govProv    ? { governance_provider: govProv } : {}),
      ...(govModel   ? { governance_model: govModel } : {}),
      ...(budget     ? { budget_usd: parseFloat(budget) } : {}),
      ...(timeout    ? { timeout_agent_ms: parseInt(timeout, 10) } : {}),
      ...(guidelines ? { guidelines } : {}),
      ...(detailedMonitoring ? { detailed_monitoring: true } : {}),
      use_dna: useDna,
      output_destination: githubEnabled ? "github" : "download",
      github_branch: githubBranch || "main",
      cli_agents: cliAgentsCfg,
      ...(Object.keys(agent_configs).length > 0 ? { agent_configs } : {}),
    };

    const body: Record<string, unknown> = { settings };
    if (pipelineId !== (project.pipeline_id ?? "")) body.pipeline_id = pipelineId || null;
    if (briefing !== (project.intake_brief ?? "")) body.intake_brief = briefing || null;

    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = await res.json() as { project?: Project; error?: string };
    if (!res.ok) { setSaving(false); setError(resBody.error ?? "Save failed."); return; }

    // Save knowledge instance links
    if (knowledgeLoaded) {
      await fetch(`/api/projects/${project.id}/knowledge`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ instances: knowledgeInstances.map((i) => ({ id: i.id, enabled: i.enabled })) }),
      }).catch(() => {});
    }

    setSaving(false);
    onSaved({ ...project, pipeline_id: pipelineId || null, intake_brief: briefing || null, settings });
    onClose();
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={inline
      ? { flex: 1, overflowY: "auto", background: "var(--mantle)" }
      : { position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }
    }>
      <div style={inline ? {} : { background: "var(--mantle)", border: "1px solid var(--surface0)", borderRadius: 18, width: "min(720px, 95vw)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>

        {/* Sticky header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--surface0)", position: "sticky", top: 0, background: "var(--mantle)", zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Project Settings</div>
            <div style={{ fontSize: 11, color: "var(--overlay0)" }}>{project.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={handleSave} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 8, border: "none", background: "var(--blue)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: "var(--font-sans)" }}>
              {saving ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={12} />}
              Save
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--overlay0)", padding: 4 }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ padding: "18px 20px" }}>

          {/* ── Briefing (always visible, first item) ────────────────── */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--overlay0)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Briefing</label>
            <textarea
              value={briefing}
              onChange={(e) => setBriefing(e.target.value)}
              placeholder="Describe the project scope, goals, and requirements..."
              rows={3}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, fontFamily: "var(--font-sans)" }}
            />
          </div>

          {/* ── 1. Pipeline ──────────────────────────────────────────── */}
          <SectionHeader id="pipeline" title="Pipeline" icon={<Zap size={14} color="var(--blue)" />} collapsed={collapsed.pipeline ?? false} onToggle={() => toggleSection("pipeline")} />
          {!collapsed.pipeline && (
            <div style={{ marginBottom: 14 }}>
              <select value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} style={ss}>
                <option value="">— none —</option>
                {(() => {
                  const system = pipelines.filter((p) => p.type === "system");
                  const custom = pipelines.filter((p) => p.type === "custom");
                  return (
                    <>
                      {custom.length > 0 && (
                        <optgroup label="Custom">
                          {custom.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({(p.steps as unknown[]).length} steps)</option>
                          ))}
                        </optgroup>
                      )}
                      {system.length > 0 && (
                        <optgroup label={ctxFactoryName ?? "Factory"}>
                          {system.map((p) => (
                            <option key={p.id} value={p.id}>{p.name} ({(p.steps as unknown[]).length} steps)</option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  );
                })()}
              </select>
            </div>
          )}

          {/* ── Default LLM ─────────────────────────────────────────── */}
          <SectionHeader id="llm" title="Default LLM" icon={<Sparkles size={14} color="var(--mauve)" />} collapsed={collapsed.llm ?? false} onToggle={() => toggleSection("llm")}
            badge={defProv
              ? <span style={{ fontSize: 10, color: "var(--blue)", fontWeight: 600 }}>{PROVIDER_DISPLAY[defProv] ?? defProv}{defModel ? ` / ${defModel}` : ""}</span>
              : <span style={{ fontSize: 10, color: "var(--peach)" }}>
                  {liveProviders.length > 0
                    ? "not set — select a provider"
                    : "configure in Providers first"}
                </span>}
          />
          {!collapsed.llm && (
            <div style={{ marginBottom: 14 }}>
              {liveProviders.length === 0 ? (
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(245,159,0,0.06)", border: "1px solid rgba(245,159,0,0.15)", fontSize: 12, color: "var(--peach)", lineHeight: 1.6 }}>
                  No LLM providers configured.{" "}
                  <a href="/providers" target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "none" }}>
                    Add API keys in Providers <ExternalLink size={9} style={{ verticalAlign: "middle" }} />
                  </a>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>Provider & Model</label>
                    <div style={grid2}>
                      <ProviderSelect value={defProv} onChange={(v) => { setDefProv(v); setDefModel(""); }} style={ss} providers={liveProviders} />
                      <ModelSelect provider={defProv} value={defModel} onChange={setDefModel} style={ss} providers={liveProviders} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--overlay0)" }}>
                    Per-agent overrides can be set in Agent Configuration below.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 2. Orchestration Mode ────────────────────────────────── */}
          <SectionHeader id="orchestration" title="Orchestration Mode" icon={<Settings size={14} color="var(--teal)" />} collapsed={collapsed.orchestration ?? false} onToggle={() => toggleSection("orchestration")} />
          {!collapsed.orchestration && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 11, color: "var(--overlay0)", margin: "0 0 8px 0", lineHeight: 1.5 }}>
                How agents execute: cloud API calls or local CLI processes on your machine.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {([
                  { id: "local" as const, label: "Local", desc: "Run headless CLIs on your machine" },
                  { id: "cloud" as const, label: "Cloud", desc: "Use provider APIs (Anthropic, OpenAI, etc.)" },
                ]).map((opt) => (
                  <button key={opt.id} onClick={() => {
                    setOrchMode(opt.id);
                    if (opt.id === "local") {
                      setCliEnabled(true); setCliBackend("local");
                      // Auto-set all agents to CLI SUBS
                      setCliOverrides((prev) => {
                        const next = { ...prev };
                        for (const agent of pipelineAgents) {
                          next[agent] = { ...(next[agent] ?? { enabled: true, cli: (cliDefaultCli || "claude-code") as SupportedCli }), enabled: true, authMode: "oauth" };
                        }
                        return next;
                      });
                    } else {
                      setCliEnabled(false); setCliBackend("supabase");
                      // Auto-set all agents to API
                      setCliOverrides({});
                    }
                  }} style={{
                    textAlign: "left", padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                    border: `1.5px solid ${orchMode === opt.id ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                    background: orchMode === opt.id ? "rgba(20,99,255,0.08)" : "var(--surface0)",
                    fontFamily: "var(--font-sans)",
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: orchMode === opt.id ? "#1463ff" : "var(--text)", marginBottom: 3 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: "var(--subtext0)" }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── 3. CLI Agents (only when orchMode=local) ──────────────── */}
          {orchMode === "local" && (
            <>
              <SectionHeader id="cli" title="CLI Agents" icon={<Terminal size={14} color="var(--green)" />} collapsed={collapsed.cli ?? false} onToggle={() => toggleSection("cli")}
                badge={<a href="/providers" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: 10, color: "var(--blue)", textDecoration: "none", display: "flex", alignItems: "center", gap: 3 }}>
                  <ExternalLink size={10} /> Providers
                </a>}
              />
              {!collapsed.cli && (
                <div style={{ paddingLeft: 8, display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>

                  {/* Storage — always User Space */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--subtext0)", width: 100, flexShrink: 0 }}>Storage</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>User Space</span>
                  </div>

                  {/* Base path input */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 8, background: "var(--crust)", border: "1px solid var(--surface0)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--subtext0)", width: 90, flexShrink: 0 }}>Base path</span>
                      <input
                        value={cliLocalBasePath}
                        onChange={(e) => setCliLocalBasePath(e.target.value)}
                        placeholder={globalBasePath || "C:\\projects  or  /home/user/projects"}
                        style={{ ...inputStyle, padding: "5px 8px", fontSize: 11, height: 28, flex: 1 }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--overlay0)", marginLeft: 98 }}>
                      Agent workdir = <code style={{ fontFamily: "monospace" }}>{cliLocalBasePath || "<base path>"}/{"{projectSlug}"}</code>
                    </div>
                  </div>

                  {/* MCP server toggle */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--subtext0)", width: 100, flexShrink: 0 }}>MCP server</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11 }}>
                      <input type="checkbox" checked={cliMcpEnabled} onChange={(e) => setCliMcpEnabled(e.target.checked)}
                        style={{ width: 13, height: 13, accentColor: "var(--blue)" }} />
                      Expose {brand.shortName} tools to MCP-capable CLIs
                    </label>
                  </div>

                  {/* Hooks toggle */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--subtext0)", width: 100, flexShrink: 0 }}>Hooks</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11 }}>
                      <input type="checkbox" checked={cliHooksEnabled} onChange={(e) => setCliHooksEnabled(e.target.checked)}
                        style={{ width: 13, height: 13, accentColor: "var(--blue)" }} />
                      Install PreToolUse / PostToolUse / Stop hooks
                    </label>
                    <span style={{ fontSize: 10, color: "var(--overlay0)" }}>Claude Code only</span>
                  </div>

                  {/* Default CLI tool */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--subtext0)", width: 100, flexShrink: 0 }}>Default CLI</span>
                    <select value={cliDefaultCli} onChange={(e) => setCliDefaultCli(e.target.value as SupportedCli | "")}
                      style={{ ...inputStyle, padding: "5px 8px", fontSize: 11, height: 28, width: 160 }}>
                      <option value="">— pick a CLI —</option>
                      {(["claude-code", "aider", "codex", "plandex", "goose", "amp", "gemini-cli"] as SupportedCli[]).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  {/* Default max turns */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--subtext0)", width: 100, flexShrink: 0 }}>Default turns</span>
                    <input type="number" value={cliDefaultMaxTurns} onChange={(e) => setCliDefaultMaxTurns(e.target.value)}
                      placeholder="1"
                      style={{ ...inputStyle, padding: "5px 8px", fontSize: 11, height: 28, width: 80 }} />
                    <span style={{ fontSize: 10, color: "var(--overlay0)" }}>Max turns per agent (default: 1)</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── 4. Agent Configuration (unified table) ────────────────── */}
          <SectionHeader id="agents" title="Agent Configuration" icon={<Sparkles size={14} color="var(--yellow)" />} collapsed={collapsed.agents ?? false} onToggle={() => toggleSection("agents")} />
          {!collapsed.agents && (
            <div style={{ marginBottom: 14 }}>
              {Object.keys(agentCfgs).length === 0 && pipelineAgents.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--overlay0)", padding: "8px 0 12px" }}>
                  Select a pipeline above to see its agents here.
                </div>
              )}

              {/* Unified agent rows */}
              {(pipelineAgents.length > 0 ? pipelineAgents : Object.keys(agentCfgs)).map((agentName) => {
                const cfg = agentCfgs[agentName] ?? emptyAgentCfg();
                const override = cliOverrides[agentName];
                const usesCli = override?.enabled === true;
                const routingMode = !usesCli ? "api" : override?.authMode === "oauth" ? "cli-subs" : "cli-api";
                const isApiExpanded = expandedAgent === agentName;
                const isCliExpanded = expandedCliAgent === agentName;
                const activeCli = override?.cli ?? cliDefaultCli ?? "claude-code";
                const active = !cfg.disabled && hasOverrides(cfg);

                return (
                  <div key={agentName} style={{ marginBottom: 6, borderRadius: 10, overflow: "hidden",
                    border: `1px solid ${active ? "rgba(20,99,255,0.3)" : usesCli ? "rgba(166,227,161,0.2)" : "var(--surface1)"}`,
                    background: active ? "rgba(20,99,255,0.04)" : usesCli ? "rgba(166,227,161,0.04)" : "var(--surface0)",
                  }}>
                    {/* Row header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px" }}>
                      <code style={{ fontSize: 11, fontWeight: 700, color: active ? "#1463ff" : "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {agentName}
                      </code>

                      {/* Routing: API / CLI API / CLI SUBS */}
                      <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--surface1)", flexShrink: 0 }}>
                        {([
                          { id: "api" as const,      label: "API",      color: "#1463ff", bg: "rgba(20,99,255,0.15)", disabled: false },
                          { id: "cli-api" as const,  label: "CLI API",  color: "var(--green)", bg: "rgba(166,227,161,0.18)", disabled: true },
                          { id: "cli-subs" as const, label: "CLI SUBS", color: "var(--yellow)", bg: "rgba(249,226,175,0.18)", disabled: orchMode === "cloud" },
                        ]).map((opt, i) => (
                          <button key={opt.id} title={opt.id === "cli-api" ? "Coming soon" : opt.disabled ? "Switch to Local orchestration to enable" : undefined}
                            onClick={() => {
                              if (opt.disabled) return;
                              if (opt.id === "api") { setCliAgentEnabled(agentName, false); }
                              else { setCliAgentEnabled(agentName, true); setCliAgentField(agentName, "authMode", opt.id === "cli-subs" ? "oauth" : "api-key"); }
                            }} style={{
                              padding: "3px 8px", fontSize: 10, fontWeight: routingMode === opt.id ? 700 : 400,
                              background: routingMode === opt.id ? opt.bg : "transparent",
                              color: opt.disabled ? "var(--surface2)" : routingMode === opt.id ? opt.color : "var(--overlay0)",
                              border: "none", borderLeft: i > 0 ? "1px solid var(--surface1)" : "none",
                              cursor: opt.disabled ? "not-allowed" : "pointer", fontFamily: "var(--font-sans)",
                              opacity: opt.disabled ? 0.5 : 1,
                            }}>{opt.label}</button>
                        ))}
                      </div>

                      {/* Config button */}
                      <button onClick={() => {
                        if (routingMode === "cli-subs") { setExpandedCliAgent(isCliExpanded ? null : agentName); setExpandedAgent(null); }
                        else if (routingMode === "api") { setExpandedAgent(isApiExpanded ? null : agentName); setExpandedCliAgent(null); }
                      }} title="Configure agent"
                        style={{ background: "none", border: "none", cursor: routingMode === "cli-api" ? "not-allowed" : "pointer", color: "var(--overlay0)", padding: "2px 4px", flexShrink: 0, opacity: routingMode === "cli-api" ? 0.3 : 1 }}
                        disabled={routingMode === "cli-api"}
                      >
                        <Settings size={12} />
                      </button>
                    </div>

                    {/* Expanded API config */}
                    {routingMode === "api" && isApiExpanded && (
                      <div style={{ padding: "0 12px 12px", borderTop: "1px solid var(--surface1)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, marginBottom: 8 }}>
                          <div>
                            <label style={{ ...labelStyle, marginBottom: 4 }}>Provider</label>
                            <ProviderSelect value={cfg.provider} onChange={(v) => { setAgentField(agentName, "provider", v); setAgentField(agentName, "model", ""); }} style={ss} providers={liveProviders} />
                          </div>
                          <div>
                            <label style={{ ...labelStyle, marginBottom: 4 }}>Model</label>
                            <ModelSelect provider={cfg.provider} value={cfg.model} onChange={(v) => setAgentField(agentName, "model", v)} style={ss} providers={liveProviders} />
                          </div>
                          <div>
                            <label style={{ ...labelStyle, marginBottom: 4 }}>Max tool rounds</label>
                            <input value={cfg.max_tool_rounds} onChange={(e) => setAgentField(agentName, "max_tool_rounds", e.target.value)} placeholder="e.g. 15" type="number" style={ss} />
                          </div>
                          <div>
                            <label style={{ ...labelStyle, marginBottom: 4 }}>Timeout (ms)</label>
                            <input value={cfg.timeout_ms} onChange={(e) => setAgentField(agentName, "timeout_ms", e.target.value)} placeholder="e.g. 300000" type="number" style={ss} />
                          </div>
                          <div>
                            <label style={{ ...labelStyle, marginBottom: 4 }}>Max tokens</label>
                            <input value={cfg.max_tokens} onChange={(e) => setAgentField(agentName, "max_tokens", e.target.value)} placeholder="e.g. 8192" type="number" style={ss} />
                          </div>
                          <div style={{ display: "flex", alignItems: "flex-end" }}>
                            <button onClick={() => removeAgent(agentName)} style={{ width: "100%", padding: "6px", borderRadius: 7, border: "1px solid rgba(228,75,95,0.3)", background: "rgba(228,75,95,0.08)", color: "var(--red)", fontSize: 11, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
                              Remove overrides
                            </button>
                          </div>
                        </div>
                        <div>
                          <label style={{ ...labelStyle, marginBottom: 4 }}>Agent-specific guidelines</label>
                          <textarea value={cfg.guidelines} onChange={(e) => setAgentField(agentName, "guidelines", e.target.value)}
                            placeholder="Extra instructions appended to this agent's system prompt…"
                            rows={2} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, fontSize: 12 }} />
                        </div>
                      </div>
                    )}

                    {/* Expanded CLI SUBS config */}
                    {routingMode === "cli-subs" && isCliExpanded && (
                      <div style={{ padding: "8px 12px 10px", borderTop: "1px solid var(--surface0)", display: "flex", flexDirection: "column", gap: 7 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                          <div style={{ width: 140 }}>
                            <label style={{ fontSize: 10, color: "var(--subtext0)", display: "block", marginBottom: 3 }}>CLI</label>
                            <select value={activeCli} onChange={(e) => setCliAgentField(agentName, "cli", e.target.value as SupportedCli)}
                              style={{ ...inputStyle, padding: "4px 7px", fontSize: 11, height: 26, width: "100%" }}>
                              {(["claude-code", "aider", "codex", "plandex", "goose", "amp", "gemini-cli"] as SupportedCli[]).map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ width: 80 }}>
                            <label style={{ fontSize: 10, color: "var(--subtext0)", display: "block", marginBottom: 3 }}>Turns</label>
                            <input type="number" value={override?.max_turns ?? ""} onChange={(e) => setCliAgentField(agentName, "max_turns", e.target.value ? Number(e.target.value) : undefined as unknown as number)}
                              placeholder="1"
                              style={{ ...inputStyle, padding: "4px 7px", fontSize: 11, height: 26, width: "100%" }} />
                          </div>
                          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, paddingBottom: 4 }}>
                            <input type="checkbox" checked={cliMcpEnabled} onChange={(e) => setCliMcpEnabled(e.target.checked)}
                              style={{ width: 12, height: 12, accentColor: "var(--blue)" }} />
                            MCP
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, paddingBottom: 4 }}>
                            <input type="checkbox" checked={cliHooksEnabled} onChange={(e) => setCliHooksEnabled(e.target.checked)}
                              style={{ width: 12, height: 12, accentColor: "var(--blue)" }} />
                            Hooks
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add agent from pipeline dropdown */}
              {pipelineAgents.filter((a) => !agentCfgs[a]).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const name = e.target.value;
                      if (!name) return;
                      setAgentCfgs((prev) => ({ ...prev, [name]: emptyAgentCfg() }));
                      setExpandedAgent(name);
                      e.target.value = "";
                    }}
                    style={{ ...ss, width: "100%", color: "var(--subtext0)" }}
                  >
                    <option value="">+ Add agent override…</option>
                    {pipelineAgents.filter((a) => !agentCfgs[a]).map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* ── 5. CAG — Context-Augmented Generation ─────────────── */}
          <SectionHeader id="cag" title="CAG — Context-Augmented Generation" icon={<Brain size={14} color="var(--peach)" />} collapsed={collapsed.cag ?? false} onToggle={() => toggleSection("cag")} />
          {!collapsed.cag && (
            <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 14 }}>

              <div style={divider} />

              {/* DNA Context */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <label style={labelStyle}>DNA Context</label>
                  <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2 }}>
                    Inject factory DNA (stack, standards, identity) into agent briefings. Disable for standalone projects.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setUseDna((v: boolean) => !v)}
                  style={{
                    flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0,
                    color: useDna ? "var(--green)" : "var(--overlay0)",
                  }}
                >
                  {useDna ? "●  On" : "○  Off"}
                </button>
              </div>

              <div style={divider} />

              {/* AI Focus Mode */}
              <div>
                <label style={labelStyle}>AI Focus Mode</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {(["speed", "balanced", "quality"] as FocusMode[]).map((f) => (
                    <button key={f} onClick={() => applyAutoConfig(f)} style={{
                      padding: "9px 8px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-sans)",
                      border: `1.5px solid ${focus === f ? "rgba(20,99,255,0.5)" : "var(--surface1)"}`,
                      background: focus === f ? "rgba(20,99,255,0.08)" : "var(--surface0)",
                      color: focus === f ? "#1463ff" : "var(--subtext0)", fontSize: 12, fontWeight: 600,
                    }}>
                      {f === "speed" ? "⚡ Low" : f === "balanced" ? "⚖️ Balanced" : "🔬 High"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={divider} />

              {/* Guidelines */}
              <div>
                <label style={labelStyle}>Guidelines <span style={{ fontWeight: 400, color: "var(--overlay0)" }}>(injected into all agents)</span></label>
                <textarea value={guidelines} onChange={(e) => setGuidelines(e.target.value)}
                  placeholder="e.g. Always use TypeScript strict mode. Prefer functional components. Target Node 22."
                  rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
              </div>
            </div>
          )}

          {/* ── 6. RAG — Retrieval-Augmented Generation ────────────── */}
          <SectionHeader id="rag" title="RAG — Retrieval-Augmented Generation" icon={<Brain size={14} color="var(--mauve)" />}
            collapsed={collapsed.rag ?? false} onToggle={() => toggleSection("rag")}
            badge={knowledgeInstances.filter((i) => i.enabled).length > 0
              ? <span style={{ fontSize: 10, color: "var(--green)" }}>{knowledgeInstances.filter((i) => i.enabled).length} active</span>
              : undefined}
          />
          {!collapsed.rag && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--overlay0)", marginBottom: 10 }}>
                Link knowledge instances to this project. Agents will search linked instances during sprints.
                <a href="/knowledge" target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "none", marginLeft: 6 }}>
                  Manage instances <ExternalLink size={9} style={{ verticalAlign: "middle" }} />
                </a>
              </div>

              {!knowledgeLoaded ? (
                <div style={{ fontSize: 12, color: "var(--overlay0)" }}>Loading...</div>
              ) : knowledgeInstances.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--overlay0)", padding: "12px", background: "var(--crust)", borderRadius: 8, textAlign: "center" }}>
                  No knowledge instances available.{" "}
                  <a href="/knowledge" target="_blank" rel="noreferrer" style={{ color: "var(--blue)", textDecoration: "none" }}>
                    Create one first.
                  </a>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {knowledgeInstances.map((inst) => (
                    <div key={inst.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "7px 10px", borderRadius: 6,
                      background: inst.enabled ? "rgba(203,166,247,0.06)" : "var(--crust)",
                      border: `1px solid ${inst.enabled ? "rgba(203,166,247,0.2)" : "var(--surface0)"}`,
                    }}>
                      <button type="button"
                        onClick={() => setKnowledgeInstances((prev) =>
                          prev.map((i) => i.id === inst.id ? { ...i, enabled: !i.enabled } : i)
                        )}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: inst.enabled ? "var(--mauve)" : "var(--overlay0)", fontSize: 14 }}>
                        {inst.enabled ? "●" : "○"}
                      </button>
                      <span style={{ flex: 1, fontSize: 12, color: "var(--text)", fontWeight: inst.enabled ? 600 : 400 }}>{inst.name}</span>
                      <span style={{ fontSize: 10, color: "var(--overlay0)" }}>{inst.chunkCount} chunks</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── 8. Budget & Limits ────────────────────────────────────── */}
          <SectionHeader id="budget" title="Budget & Limits" icon={<AlertTriangle size={14} color="var(--peach)" />} collapsed={collapsed.budget ?? false} onToggle={() => toggleSection("budget")} />
          {!collapsed.budget && (
            <div style={{ marginBottom: 14 }}>
              <div style={grid2}>
                <div>
                  <label style={labelStyle}>Budget cap (USD)</label>
                  <input value={budget}  onChange={(e) => setBudget(e.target.value)}   placeholder="e.g. 5.00"    type="number" step="0.01"  style={ss} />
                </div>
                <div>
                  <label style={labelStyle}>Agent timeout (ms)</label>
                  <input value={timeout} onChange={(e) => setTimeout_(e.target.value)} placeholder="e.g. 600000" type="number" step="1000" style={ss} />
                </div>
              </div>
            </div>
          )}

          {/* ── 9. Monitoring ─────────────────────────────────────────── */}
          <SectionHeader id="monitoring" title="Monitoring" icon={<Search size={14} color="var(--blue)" />} collapsed={collapsed.monitoring ?? false} onToggle={() => toggleSection("monitoring")} />
          {!collapsed.monitoring && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
                <div>
                  <div style={labelStyle}>Detailed monitoring</div>
                  <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2 }}>
                    Emit DB events per tool-call round for the live execution log.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailedMonitoring((v: boolean) => !v)}
                  style={{
                    flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0,
                    color: detailedMonitoring ? "var(--green)" : "var(--overlay0)",
                  }}
                >
                  {detailedMonitoring ? "●  On" : "○  Off"}
                </button>
              </div>
              <div>
                <label style={labelStyle}>On human rejection</label>
                <select value={onReject} onChange={(e) => setOnReject(e.target.value as OnRejection)} style={ss}>
                  <option value="end_sprint">End sprint (default)</option>
                  <option value="retry_once">Retry agent once</option>
                  <option value="skip">Skip step and continue</option>
                  <option value="request_instructions">Pause and request instructions</option>
                </select>
              </div>
            </div>
          )}

          {/* ── 10. GitHub ────────────────────────────────────────────── */}
          <SectionHeader id="github" title="GitHub" icon={<GitBranch size={14} color="var(--text)" />} collapsed={collapsed.github ?? false} onToggle={() => toggleSection("github")} />
          {!collapsed.github && (
            <div style={{ marginBottom: 14 }}>
              {/* Git repo status */}
              {githubEnabled && gitStatus && (
                <div style={{
                  padding: "7px 10px", borderRadius: 7, fontSize: 11, lineHeight: 1.6,
                  display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 10,
                  background: gitStatus.exists === true  ? "rgba(28,191,107,0.08)"
                            : gitStatus.exists === false ? "rgba(107,122,158,0.08)"
                            : "rgba(254,188,43,0.08)",
                  border: `1px solid ${gitStatus.exists === true  ? "rgba(28,191,107,0.25)"
                                      : gitStatus.exists === false ? "rgba(107,122,158,0.2)"
                                      : "rgba(254,188,43,0.25)"}`,
                  color: gitStatus.exists === true  ? "var(--green)"
                       : gitStatus.exists === false ? "var(--subtext0)"
                       : "var(--yellow)",
                }}>
                  <GitBranch size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {gitStatus.exists === true  && <>Repo <code style={{ fontFamily: "monospace" }}>{gitStatus.repoName}</code> found — will be cloned automatically on first sprint.</>}
                    {gitStatus.exists === false && <>Repo <code style={{ fontFamily: "monospace" }}>{gitStatus.repoName}</code> does not exist — will be created on first Push to GitHub.</>}
                    {gitStatus.exists === null  && <>GitHub not configured — no git integration for this project.</>}
                  </span>
                </div>
              )}
              {/* Enable GitHub toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
                <div>
                  <div style={labelStyle}>Enable GitHub</div>
                  <div style={{ fontSize: 11, color: "var(--overlay0)", marginTop: 2 }}>
                    Push sprint artifacts to a GitHub repository.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setGithubEnabled((v: boolean) => !v)}
                  style={{
                    flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0,
                    color: githubEnabled ? "var(--green)" : "var(--overlay0)",
                  }}
                >
                  {githubEnabled ? "●  On" : "○  Off"}
                </button>
              </div>

              {githubEnabled && (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>Branch name</label>
                    <input
                      value={githubBranch}
                      onChange={(e) => setGithubBranch(e.target.value)}
                      placeholder="main"
                      style={{ ...ss, width: "100%", maxWidth: 240 }}
                    />
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
                    <input type="checkbox" checked={githubAutoPush} onChange={(e) => setGithubAutoPush(e.target.checked)}
                      style={{ width: 14, height: 14, accentColor: "var(--blue)" }} />
                    Auto-push on sprint completion
                  </label>
                </>
              )}
            </div>
          )}

          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(228,75,95,0.1)", border: "1px solid rgba(228,75,95,0.3)", color: "var(--red)", fontSize: 13, marginTop: 10 }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}
        </div>

        {/* Sticky footer — only in modal mode */}
        {!inline && (
          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--surface0)", display: "flex", gap: 10, position: "sticky", bottom: 0, background: "var(--mantle)" }}>
            <button onClick={onClose} style={{ padding: "9px 18px", borderRadius: 9, border: "1px solid var(--surface1)", background: "transparent", color: "var(--subtext0)", fontSize: 13, cursor: "pointer", fontFamily: "var(--font-sans)" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "9px", borderRadius: 9, border: "none", background: "#1463ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "var(--font-sans)" }}>
              {saving ? <><RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> Saving…</> : "Save settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  fontSize: 10, padding: "1px 7px", borderRadius: 4,
  background: "rgba(20,99,255,0.12)", color: "#1463ff", fontWeight: 600,
};

/* ── ProjectCard + SprintRow imported from @/components/ProjectCard ─────────── */

// Section helper wraps ProjectCard list with a label
/* ── Section (module-level to preserve ProjectCard state across parent re-renders) */
function Section({ label, items, onDelete, onToggleLock, onEditSettings }: {
  label: string;
  items: Project[];
  onDelete: (p: Project) => void;
  onToggleLock: (p: Project) => void;
  onEditSettings: (p: Project) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--overlay0)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        {label} <span style={{ fontSize: 10, background: "var(--surface1)", borderRadius: 99, padding: "0 5px", lineHeight: "16px", fontWeight: 400 }}>{items.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            onDelete={onDelete}
            onToggleLock={onToggleLock}
            onEditSettings={onEditSettings}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Main Projects Page ──────────────────────────────────────────────────────── */

export function ProjectsPageInner({ asPanel = false }: { asPanel?: boolean } = {}) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const autoOpened   = useRef(false);
  const { session, tenantId, factoryId, factorySlug, loading: authLoading } = useAuth();
  const [projects,     setProjects]     = useState<Project[]>([]);
  const [pipelines,    setPipelines]    = useState<Pipeline[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState("");
  const [showNew,      setShowNew]      = useState(false);
  const [editSettings, setEditSettings] = useState<Project | null>(null);
  const [dataReady,    setDataReady]    = useState(false);

  useEffect(() => {
    if (asPanel) return; // Studio already handles auth guard
    if (!authLoading && !session) router.replace("/login");
  }, [asPanel, authLoading, session, router]);

  useEffect(() => {
    if (!factoryId || !tenantId || !session) return;

    // Load projects first — show page immediately
    fetch(`/api/projects?factoryId=${factoryId}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (projRes) => {
        if (projRes.ok) { const b = await projRes.json() as { projects: Project[] }; setProjects(b.projects); }
        setLoading(false);
        setDataReady(true);
        if (!autoOpened.current && searchParams.get("pipeline")) {
          autoOpened.current = true;
          setShowNew(true);
        }
      });

    // Load pipelines in background — only needed for NewProjectModal
    fetch(`/api/pipelines?tenantId=${tenantId}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (pipeRes) => {
        if (pipeRes.ok) { const b = await pipeRes.json() as { system: Pipeline[]; custom: Pipeline[] }; setPipelines([...b.system, ...b.custom]); }
      });
  }, [factoryId, tenantId, session, searchParams]);

  const filtered = projects.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.slug.includes(search.toLowerCase())
  );

  const byStatus = {
    active: filtered.filter((p) => ["executing", "running", "waiting", "provisioning"].includes(p.status)),
    queued: filtered.filter((p) => ["queued"].includes(p.status)),
    rest:   filtered.filter((p) => !["executing", "running", "waiting", "provisioning", "queued"].includes(p.status)),
  };

  if (!dataReady) {
    return (
      <div style={{ display: "flex", height: asPanel ? "100%" : "100vh", alignItems: "center", justifyContent: "center", background: "var(--base)" }}>
        <div style={{ fontSize: 13, color: "var(--overlay0)" }}>Loading…</div>
      </div>
    );
  }

  async function handleDelete(project: Project) {
    if (project.locked) return;
    if (ACTIVE_STATUSES.includes(project.status as string)) return;
    const input = prompt(`Type "${project.slug}" to confirm deletion of this project, all sprints, and all artifacts:`);
    if (input !== project.slug) return;
    if (!session) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } else {
      const body = await res.json() as { error?: string };
      alert(body.error ?? "Failed to delete project.");
    }
  }

  async function handleToggleLock(project: Project) {
    if (!session) return;
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ locked: !project.locked }),
    });
    if (res.ok) {
      setProjects((prev) => prev.map((p) => p.id === project.id ? { ...p, locked: !p.locked } : p));
    }
  }

  return (
    <div style={{ display: "flex", height: asPanel ? "100%" : "100vh", background: "var(--base)", fontFamily: "var(--font-sans)", color: "var(--text)", overflow: "hidden", flex: asPanel ? 1 : undefined }}>
      {!asPanel && <AppSidebar active="projects" />}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* List view */}
        <div style={{ flex: 1, overflowY: "auto", display: (showNew || editSettings) ? "none" : "block" }}>
        <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Projects</h2>
              <p style={{ fontSize: 13, color: "var(--subtext0)" }}>
                {loading ? "Loading…" : `${projects.length} projects · each pipeline run = one sprint`}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ position: "relative" }}>
                <Search size={13} color="var(--overlay0)" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter projects…"
                  style={{ ...inputStyle, padding: "7px 10px 7px 30px", width: 200, fontSize: 12 }} />
              </div>
              <button
                onClick={() => setShowNew(true)}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 9, border: "none", background: "#1463ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)", whiteSpace: "nowrap" }}
              >
                <Plus size={14} /> New project
              </button>
            </div>
          </div>

          <div>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "var(--overlay0)", fontSize: 13 }}>Loading projects…</div>
          ) : projects.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16, color: "var(--overlay0)" }}>
              <FolderOpen size={40} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>No projects yet</div>
                <p style={{ fontSize: 13, margin: 0 }}>Create your first project to start running pipelines.</p>
              </div>
              <button onClick={() => setShowNew(true)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, border: "none", background: "#1463ff", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-sans)" }}>
                <Plus size={14} /> New project
              </button>
            </div>
          ) : (
            <>
              <Section label="Active" items={byStatus.active} onDelete={handleDelete} onToggleLock={handleToggleLock} onEditSettings={(proj) => setEditSettings(proj)} />
              <Section label="In Office" items={byStatus.queued} onDelete={handleDelete} onToggleLock={handleToggleLock} onEditSettings={(proj) => setEditSettings(proj)} />
              {byStatus.rest.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={handleDelete} onToggleLock={handleToggleLock} onEditSettings={(proj) => setEditSettings(proj)} />
              ))}
              {filtered.length === 0 && projects.length > 0 && (
                <div style={{ textAlign: "center", padding: 32, color: "var(--overlay0)", fontSize: 13 }}>No results for "{search}"</div>
              )}
            </>
          )}
          </div>
        </div>
        </div>{/* end list view */}

        {/* Inline: New Project */}
        {showNew && factoryId && (
          <NewProjectModal
            factoryId={factoryId}
            factorySlug={factorySlug ?? ""}
            onClose={() => setShowNew(false)}
            onCreated={(p) => { setProjects((prev) => [p, ...prev]); setShowNew(false); }}
            onOpenSettings={(p) => { setShowNew(false); setEditSettings(p); }}
            inline
          />
        )}

        {/* Inline: Project Settings */}
        {editSettings && (
          <ProjectSettingsModal
            project={editSettings as Project & { settings?: ProjectSettings }}
            pipelines={pipelines}
            onClose={() => setEditSettings(null)}
            onSaved={(p) => {
              setProjects((prev) => prev.map((x) => x.id === p.id ? p : x));
              setEditSettings(null);
            }}
            inline
          />
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <React.Suspense fallback={<div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--base)", color: "var(--overlay0)", fontSize: 13 }}>Loading…</div>}>
      <ProjectsPageInner />
    </React.Suspense>
  );
}
