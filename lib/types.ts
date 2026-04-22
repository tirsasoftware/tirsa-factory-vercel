// ─────────────────────────────────────────────────────────────────────────────
// Primitive type aliases
// ─────────────────────────────────────────────────────────────────────────────

export type AgentLevel         = 'specialist' | 'super-specialist';
export type AgentAutonomy      = 'auto' | 'human';
export type AgentOrigin        = 'built-in' | 'user';
export type TenantPlan         = 'starter' | 'pro' | 'owner';
export type SubscriptionSource = 'plan' | 'addon' | 'squad';

// ─────────────────────────────────────────────────────────────────────────────
// Existing multi-tenant types (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  created_at: string;
}

export interface Factory {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  config: {
    max_concurrent_projects?: number;
    default_provider?: string;
    budget_alert_usd?: number;
    [key: string]: unknown;
  };
  created_at: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export type FocusMode = 'speed' | 'balanced' | 'quality';
export type OnRejection = 'retry_once' | 'end_sprint' | 'request_instructions' | 'skip';

export interface AgentProjectConfig {
  disabled?: boolean;
  provider?: string;
  model?: string;
  max_tool_rounds?: number;
  timeout_ms?: number;
  max_tokens?: number;
  guidelines?: string;
}

export interface ProjectSettings {
  focus?: FocusMode;
  planning_provider?: string;
  planning_model?: string;
  dev_provider?: string;
  dev_model?: string;
  governance_provider?: string;
  governance_model?: string;
  default_provider?: string;
  default_model?: string;
  budget_usd?: number;
  timeout_agent_ms?: number;
  guidelines?: string;
  on_rejection?: OnRejection;
  /** Emit DB events per tool-call round for live execution log. Off by default. */
  detailed_monitoring?: boolean;
  /** Replaces the shared Agent Protocol section in every agent's system prompt. */
  protocol_override?: string;
  /** Whether DNA factory context is injected into agent briefings. Default: true (when DNA is implemented). */
  use_dna?: boolean;
  agent_configs?: Record<string, AgentProjectConfig>;
  /** CLI headless agent configuration — per-agent CLI overrides */
  cli_agents?: CliAgentsConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Headless Agents
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedCli =
  | "claude-code"
  | "aider"
  | "codex"
  | "plandex"
  | "goose"
  | "amp"
  | "gemini-cli";

export type CliExecutionMode = "cloud" | "local";
/** Where CLI agent files are read from / written to */
export type CliStorageBackend = "supabase" | "local";
/** Git initialisation mode for the local workdir */
export type CliGitMode = "none" | "clone" | "existing";

/** Per-agent CLI override stored inside ProjectSettings.cli_agents.agent_overrides */
export interface CliAgentOverride {
  /** Whether this agent uses CLI instead of the standard API call */
  enabled: boolean;
  /** Which CLI tool to use */
  cli: SupportedCli;
  /** Optional model override passed to the CLI */
  model?: string;
  /** Branch prefix for auto-generated branch names */
  branch_prefix?: string;
  /** CLI process timeout in seconds (default: 600) */
  timeout_secs?: number;
  /** Max conversational turns the CLI agent may take (default: 5) */
  max_turns?: number;
  /** Whether to open a PR after the CLI commits changes */
  open_pr?: boolean;
  /** Claude Code `--effort` flag: "low" | "medium" | "high" | "max" */
  effort?: "low" | "medium" | "high" | "max";
  /** Appended at model level via `--append-system-prompt` (claude-code only) */
  append_system_prompt?: string;
}

/** Top-level CLI configuration stored in ProjectSettings.cli_agents */
export interface CliAgentsConfig {
  /** Whether headless CLI agents are enabled for this project */
  enabled?: boolean;
  /** @deprecated Use execution_backend */
  execution_mode?: CliExecutionMode;
  /** Default CLI for agents that don't have a specific override */
  default_cli?: SupportedCli;
  /** Per-agent overrides (key = agent slug) */
  agent_overrides?: Record<string, CliAgentOverride>;

  /**
   * Storage backend for CLI agent file operations.
   * "supabase" (default) — files go to Supabase Storage; works in cloud workers.
   * "local" — files go to local_base_path/{projectSlug}/ on the user's machine.
   */
  execution_backend?: CliStorageBackend;

  /**
   * Base directory on the user's local machine for the "local" backend.
   * The agent's workdir will be {local_base_path}/{projectSlug}/.
   * Required when execution_backend === "local".
   * Example: "/home/alice/projects"
   */
  local_base_path?: string;

  /**
   * Git initialisation for the local workdir.
   * "none"     — no git; plain files (default)
   * "clone"    — git clone the project's GitHub repo first
   * "existing" — workdir already has a git repo
   */
  git_mode?: CliGitMode;

  /**
   * Whether to expose the Tirsa MCP server to MCP-capable CLIs
   * (Claude Code, Plandex, Goose). Enables project file tools natively.
   * Defaults to true for supported CLIs.
   */
  mcp_enabled?: boolean;

  /**
   * Install Claude Code hooks (PreToolUse/PostToolUse/Stop).
   * Hooks log tool activity to .tirsa/hooks.log → uploaded to audit dir.
   * Only applies to claude-code runs. Defaults to false.
   */
  hooks_enabled?: boolean;

  /**
   * Default max turns for CLI agents in this project.
   * Falls back to 5 when omitted.
   */
  default_max_turns?: number;
}

/** Static metadata for each supported CLI */
export interface CliProviderMeta {
  id: SupportedCli;
  name: string;
  description: string;
  /** Execution modes this CLI supports */
  modes: CliExecutionMode[];
  /** Env var for API key (cloud mode). Undefined = no cloud mode */
  apiKeyVar?: string;
  /** Whether this CLI supports subscription-based OAuth (local mode) */
  supportsSubscription: boolean;
  /** Name of the subscription plan */
  subscriptionName?: string;
  /** Provider of the underlying LLM (for display) */
  provider: string;
  /** URL to create/manage API key */
  apiKeyUrl?: string;
  /** URL to manage subscription */
  subscriptionUrl?: string;
  /** npm install command */
  installCmd: string;
  /** Check if installed command */
  checkCmd: string;
}

export const CLI_PROVIDERS: CliProviderMeta[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's official agentic coding CLI. Supports subscription OAuth (Claude Max) or API key.",
    modes: ["cloud", "local"],
    apiKeyVar: "ANTHROPIC_API_KEY",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    supportsSubscription: true,
    subscriptionName: "Claude Max",
    subscriptionUrl: "https://claude.ai/upgrade",
    provider: "Anthropic",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    checkCmd: "claude --version",
  },
  {
    id: "aider",
    name: "Aider",
    description: "Multi-provider AI pair programming in the terminal. Works with Anthropic, OpenAI, Gemini, DeepSeek, Ollama, and more.",
    modes: ["cloud"],
    apiKeyVar: "ANTHROPIC_API_KEY",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    supportsSubscription: false,
    provider: "Multi-provider",
    installCmd: "pip install aider-chat",
    checkCmd: "aider --version",
  },
  {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI's agentic CLI. Supports subscription OAuth (ChatGPT Plus/Pro) or API key.",
    modes: ["cloud", "local"],
    apiKeyVar: "OPENAI_API_KEY",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    supportsSubscription: true,
    subscriptionName: "ChatGPT Plus / Pro",
    subscriptionUrl: "https://chatgpt.com/upgrade",
    provider: "OpenAI",
    installCmd: "npm install -g @openai/codex",
    checkCmd: "codex --version",
  },
  {
    id: "plandex",
    name: "Plandex",
    description: "Open-source AI coding engine for large tasks and codebases. Cloud and self-hosted.",
    modes: ["cloud"],
    apiKeyVar: "OPENAI_API_KEY",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    supportsSubscription: false,
    provider: "OpenAI / self-hosted",
    installCmd: "npm install -g plandex",
    checkCmd: "plandex version",
  },
  {
    id: "goose",
    name: "Goose",
    description: "Block's open-source AI developer agent. Extensible via MCP tools.",
    modes: ["local"],
    supportsSubscription: false,
    provider: "Multi-provider",
    installCmd: "pip install goose-ai",
    checkCmd: "goose --version",
  },
  {
    id: "amp",
    name: "Amp",
    description: "Sourcegraph's AI coding agent with deep codebase search and multi-file editing.",
    modes: ["cloud", "local"],
    apiKeyVar: "ANTHROPIC_API_KEY",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    supportsSubscription: false,
    provider: "Anthropic / OpenAI",
    installCmd: "npm install -g @sourcegraph/amp",
    checkCmd: "amp --version",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "Google's AI coding CLI. Supports subscription OAuth (Google One AI Premium) or API key.",
    modes: ["cloud", "local"],
    apiKeyVar: "GEMINI_API_KEY",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    supportsSubscription: true,
    subscriptionName: "Google One AI Premium",
    subscriptionUrl: "https://one.google.com/about/ai-premium",
    provider: "Google",
    installCmd: "npm install -g @google/gemini-cli",
    checkCmd: "gemini --version",
  },
];

export interface Project {
  id: string;
  factory_id: string;
  name: string;
  slug: string;
  phase: 'validate' | 'grow' | 'mature' | 'sunset';
  /** Current pipeline phase name (e.g. "Planning", "Development") — updated by run-pipeline as it executes. */
  current_phase_name?: string;
  status: 'provisioning' | 'ready' | 'queued' | 'executing' | 'waiting' | 'paused' | 'completed' | 'cancelled';
  locked: boolean;
  repo_url: string | null;
  /** Git tag or branch that is the base for the current sprint. "unversioned" until first GitHub commit. */
  base_ref: string;
  bom: {
    agents: string[];
    mcps?: string[];
    llm_budget?: string;
    estimated_duration?: string;
    /** Mirrors projects.base_ref — included so agents receive it in their input context. */
    base_ref?: string;
  };
  pipeline: PipelineStep[];
  settings?: ProjectSettings;
  created_at: string;
  updated_at: string;
}

export interface PipelineStep {
  step: number;
  agent: string;
  gate: 'human' | null;
}

export interface AgentRunMetrics {
  heap_start_mb?: number;
  heap_peak_mb?:  number;
  heap_end_mb?:   number;
  wall_ms?:       number;
  llm_ms?:        number;
  artifact_count?: number;
  tokens_in?:     number;
  tokens_out?:    number;
  model?:         string | null;
  provider?:      string;
  error?:         boolean;
}

export interface AgentRun {
  id: string;
  project_id: string;
  sprint_id: string | null;
  agent: string;
  squad: string;
  status: 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
  step: number | null;
  run_type: 'run-sprint' | 'run-once' | null;
  llm_model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  input_ref: string | null;
  output_ref: string | null;
  trigger_run_id: string | null;
  github_ref: { repo: string; branch?: string; commit?: string; pr?: number } | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  metrics: AgentRunMetrics | null;
  output_size_bytes: number | null;
}

export interface AgentEvent {
  id: string;
  run_id: string;
  event_type: 'started' | 'progress' | 'output' | 'error' | 'completed' | 'log' | 'waiting_approval' | 'approved' | 'rejected' | 'human_escalation';
  payload: Record<string, unknown>;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomy — DB-mirrored types (migration 015)
// ─────────────────────────────────────────────────────────────────────────────

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  origin: AgentOrigin;
  enabled: boolean;
  display_order: number;
  created_at: string;
}

export interface Squad {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  origin: AgentOrigin;
  enabled: boolean;
  display_order: number;
  created_at: string;
}

export interface AgentDefinition {
  id: string;
  squad_id: string;
  slug: string;
  name: string;
  /** null for agents created before the specialist/super-specialist taxonomy. */
  level: AgentLevel | null;
  autonomy: AgentAutonomy;
  origin: AgentOrigin;
  enabled: boolean;
  /** Relative path to the SIPOC contract Markdown file. null for user-created agents. */
  contract_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant subscriptions — DB-mirrored types (migration 016)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanSquadGrant {
  id: string;
  plan: TenantPlan;
  squad_id: string;
}

export interface TenantSquadSubscription {
  id: string;
  tenant_id: string;
  squad_id: string;
  source: 'plan' | 'addon';
  granted_at: string;
}

export interface TenantAgentSubscription {
  id: string;
  tenant_id: string;
  agent_definition_id: string;
  source: SubscriptionSource;
  granted_at: string;
}

/** Row shape returned by the `tenant_effective_agents` view. */
export interface TenantEffectiveAgent {
  tenant_id: string;
  tenant_slug: string;
  agent_definition_id: string;
  agent_slug: string;
  agent_name: string;
  agent_level: AgentLevel | null;
  agent_autonomy: AgentAutonomy;
  squad_slug: string;
  squad_name: string;
  category_slug: string;
  access_source: SubscriptionSource;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI constants
// Squad display order per category — source of truth is now the DB
// (squads.display_order). Keep these as fallbacks for SSR/static rendering.
// ─────────────────────────────────────────────────────────────────────────────

export const SQUAD_ORDER_SOFTWARE_FACTORY = [
  'Discovery',
  'Product & Design',
  'Engineering',
  'Platform & DevOps',
  'Data Engineering',
  'AI/ML Engineering',
  'Release & Growth',
  'Operations',
  'Governance',
  'Strategy',
  'Pipeline Ops',
] as const;

export const SQUAD_ORDER_IOT_INDUSTRIAL = [
  'Embedded',
] as const;

export const SQUAD_ORDER = [
  ...SQUAD_ORDER_SOFTWARE_FACTORY,
  ...SQUAD_ORDER_IOT_INDUSTRIAL,
] as const;

export type SquadName = (typeof SQUAD_ORDER)[number];

// ─────────────────────────────────────────────────────────────────────────────
// AGENT_META — static display metadata for all built-in agents.
// Source of truth is now agent_definitions in the DB (migration 017).
// This map is kept as a local fallback for components that render before
// data is fetched (loading states, static exports, Storybook).
// Fields:
//   squad    — display name of the squad (matches SQUAD_ORDER values)
//   label    — human-readable agent name
//   color    — squad hex colour
//   level    — 'specialist' | 'super-specialist' | undefined (pre-taxonomy)
//   autonomy — 'auto' | 'human'
//   origin   — always 'built-in' here; user agents are DB-only
// ─────────────────────────────────────────────────────────────────────────────

type AgentMetaEntry = {
  squad: string;
  label: string;
  color: string;
  level?: AgentLevel;
  autonomy: AgentAutonomy;
  origin: AgentOrigin;
};

export const AGENT_META: Record<string, AgentMetaEntry> = {

  // ── Discovery ───────────────────────────────────────────────────────────────
  scout:              { squad: 'Discovery', label: 'Scout',             color: '#10b981', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  research:           { squad: 'Discovery', label: 'Research',          color: '#10b981', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  plm:                { squad: 'Discovery', label: 'PLM',               color: '#10b981', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  'product-owner':    { squad: 'Discovery', label: 'Product Owner',     color: '#10b981', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  'market-analyst':   { squad: 'Discovery', label: 'Market Analyst',    color: '#10b981', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'user-researcher':  { squad: 'Discovery', label: 'User Researcher',   color: '#10b981', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'competitive-intel':{ squad: 'Discovery', label: 'Competitive Intel', color: '#10b981', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'voice-of-customer':{ squad: 'Discovery', label: 'Voice of Customer', color: '#10b981', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Product & Design ────────────────────────────────────────────────────────
  spec:                   { squad: 'Product & Design', label: 'Spec',                 color: '#6366f1', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  design:                 { squad: 'Product & Design', label: 'Design',               color: '#6366f1', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  brand:                  { squad: 'Product & Design', label: 'Brand',                color: '#6366f1', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  architect:              { squad: 'Product & Design', label: 'Architect',            color: '#6366f1', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  eval:                   { squad: 'Product & Design', label: 'Eval',                 color: '#6366f1', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'ux-researcher':        { squad: 'Product & Design', label: 'UX Researcher',        color: '#6366f1', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'ui-designer':          { squad: 'Product & Design', label: 'UI Designer',          color: '#6366f1', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'design-system':        { squad: 'Product & Design', label: 'Design System',        color: '#6366f1', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  accessibility:          { squad: 'Product & Design', label: 'Accessibility',        color: '#6366f1', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'information-architect':{ squad: 'Product & Design', label: 'Information Architect',color: '#6366f1', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'content-designer':     { squad: 'Product & Design', label: 'Content Designer',     color: '#6366f1', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Engineering ─────────────────────────────────────────────────────────────
  developer:              { squad: 'Engineering', label: 'Developer',            color: '#f59e0b', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  builder:                { squad: 'Engineering', label: 'Builder',              color: '#f59e0b', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  qa:                     { squad: 'Engineering', label: 'QA',                   color: '#f59e0b', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  review:                 { squad: 'Engineering', label: 'Review',               color: '#f59e0b', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  debt:                   { squad: 'Engineering', label: 'Debt',                 color: '#f59e0b', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  docs:                   { squad: 'Engineering', label: 'Docs',                 color: '#f59e0b', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'frontend-developer':   { squad: 'Engineering', label: 'Frontend Developer',   color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'backend-developer':    { squad: 'Engineering', label: 'Backend Developer',    color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'fullstack-developer':  { squad: 'Engineering', label: 'Fullstack Developer',  color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'mobile-developer':     { squad: 'Engineering', label: 'Mobile Developer',     color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'ios-developer':        { squad: 'Engineering', label: 'iOS Developer',        color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'android-developer':    { squad: 'Engineering', label: 'Android Developer',    color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'react-native-developer':{ squad: 'Engineering', label: 'React Native Developer',color: '#f59e0b', level: 'super-specialist', autonomy: 'auto', origin: 'built-in' },
  'flutter-developer':    { squad: 'Engineering', label: 'Flutter Developer',    color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'api-developer':        { squad: 'Engineering', label: 'API Developer',        color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'graphql-developer':    { squad: 'Engineering', label: 'GraphQL Developer',    color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'python-developer':     { squad: 'Engineering', label: 'Python Developer',     color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'nodejs-developer':     { squad: 'Engineering', label: 'Node.js Developer',    color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'golang-developer':     { squad: 'Engineering', label: 'Go Developer',         color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'java-developer':       { squad: 'Engineering', label: 'Java Developer',       color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'dotnet-developer':     { squad: 'Engineering', label: '.NET Developer',       color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'rust-developer':       { squad: 'Engineering', label: 'Rust Developer',       color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'test-automation':      { squad: 'Engineering', label: 'Test Automation',      color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'performance-tester':   { squad: 'Engineering', label: 'Performance Tester',   color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'security-tester':      { squad: 'Engineering', label: 'Security Tester',      color: '#f59e0b', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  'sprint-push':          { squad: 'Deploy',       label: 'Sprint Push',        color: '#f59e0b', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },

  // ── Platform & DevOps ───────────────────────────────────────────────────────
  devops:                  { squad: 'Platform & DevOps', label: 'DevOps',                 color: '#0ea5e9', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  sre:                     { squad: 'Platform & DevOps', label: 'SRE',                    color: '#0ea5e9', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'platform-engineer':     { squad: 'Platform & DevOps', label: 'Platform Engineer',      color: '#0ea5e9', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'cloud-architect':       { squad: 'Platform & DevOps', label: 'Cloud Architect',        color: '#0ea5e9', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'kubernetes-engineer':   { squad: 'Platform & DevOps', label: 'Kubernetes Engineer',    color: '#0ea5e9', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'terraform-engineer':    { squad: 'Platform & DevOps', label: 'Terraform Engineer',     color: '#0ea5e9', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'ci-cd-engineer':        { squad: 'Platform & DevOps', label: 'CI/CD Engineer',         color: '#0ea5e9', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'observability-engineer':{ squad: 'Platform & DevOps', label: 'Observability Engineer', color: '#0ea5e9', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'cost-optimizer':        { squad: 'Platform & DevOps', label: 'Cost Optimizer',         color: '#0ea5e9', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'container-specialist':  { squad: 'Platform & DevOps', label: 'Container Specialist',   color: '#0ea5e9', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Data Engineering ────────────────────────────────────────────────────────
  'data-engineer':      { squad: 'Data Engineering', label: 'Data Engineer',      color: '#f97316', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'data-architect':     { squad: 'Data Engineering', label: 'Data Architect',     color: '#f97316', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'etl-engineer':       { squad: 'Data Engineering', label: 'ETL Engineer',       color: '#f97316', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'streaming-engineer': { squad: 'Data Engineering', label: 'Streaming Engineer', color: '#f97316', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'dbt-engineer':       { squad: 'Data Engineering', label: 'DBT Engineer',       color: '#f97316', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'warehouse-engineer': { squad: 'Data Engineering', label: 'Warehouse Engineer', color: '#f97316', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'analytics-engineer': { squad: 'Data Engineering', label: 'Analytics Engineer', color: '#f97316', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── AI/ML Engineering ───────────────────────────────────────────────────────
  'ml-engineer':              { squad: 'AI/ML Engineering', label: 'ML Engineer',              color: '#a855f7', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'llm-engineer':             { squad: 'AI/ML Engineering', label: 'LLM Engineer',             color: '#a855f7', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'prompt-engineer':          { squad: 'AI/ML Engineering', label: 'Prompt Engineer',          color: '#a855f7', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'mlops-engineer':           { squad: 'AI/ML Engineering', label: 'MLOps Engineer',           color: '#a855f7', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'data-scientist':           { squad: 'AI/ML Engineering', label: 'Data Scientist',           color: '#a855f7', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'computer-vision-engineer': { squad: 'AI/ML Engineering', label: 'Computer Vision Engineer', color: '#a855f7', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'nlp-engineer':             { squad: 'AI/ML Engineering', label: 'NLP Engineer',             color: '#a855f7', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'rag-engineer':             { squad: 'AI/ML Engineering', label: 'RAG Engineer',             color: '#a855f7', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Release & Growth ────────────────────────────────────────────────────────
  release:               { squad: 'Release & Growth', label: 'Release',               color: '#ec4899', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  growth:                { squad: 'Release & Growth', label: 'Growth',                color: '#ec4899', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  experiment:            { squad: 'Release & Growth', label: 'Experiment',            color: '#ec4899', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  localization:          { squad: 'Release & Growth', label: 'Localization',          color: '#ec4899', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'seo-specialist':      { squad: 'Release & Growth', label: 'SEO Specialist',        color: '#ec4899', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'content-strategist':  { squad: 'Release & Growth', label: 'Content Strategist',    color: '#ec4899', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'ab-test-engineer':    { squad: 'Release & Growth', label: 'A/B Test Engineer',     color: '#ec4899', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'feature-flag-engineer':{ squad: 'Release & Growth', label: 'Feature Flag Engineer',color: '#ec4899', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'app-store-specialist':{ squad: 'Release & Growth', label: 'App Store Specialist',  color: '#ec4899', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Operations ──────────────────────────────────────────────────────────────
  support:           { squad: 'Operations', label: 'Support',           color: '#8b5cf6', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  incident:          { squad: 'Operations', label: 'Incident',          color: '#8b5cf6', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  finance:           { squad: 'Operations', label: 'Finance',           color: '#8b5cf6', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  monetization:      { squad: 'Operations', label: 'Monetization',      color: '#8b5cf6', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  data:              { squad: 'Operations', label: 'Data',              color: '#8b5cf6', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'customer-success':{ squad: 'Operations', label: 'Customer Success',  color: '#8b5cf6', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'billing-engineer':{ squad: 'Operations', label: 'Billing Engineer',  color: '#8b5cf6', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'knowledge-manager':{ squad: 'Operations', label: 'Knowledge Manager',color: '#8b5cf6', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'cost-analyst':    { squad: 'Operations', label: 'Cost Analyst',      color: '#8b5cf6', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Governance ──────────────────────────────────────────────────────────────
  security:        { squad: 'Governance', label: 'Security',        color: '#ef4444', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  compliance:      { squad: 'Governance', label: 'Compliance',      color: '#ef4444', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  privacy:         { squad: 'Governance', label: 'Privacy',         color: '#ef4444', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  'appsec-engineer':{ squad: 'Governance', label: 'AppSec Engineer', color: '#ef4444', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  pentester:       { squad: 'Governance', label: 'Pentester',       color: '#ef4444', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'gdpr-specialist':{ squad: 'Governance', label: 'GDPR Specialist', color: '#ef4444', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
  'soc2-specialist':{ squad: 'Governance', label: 'SOC 2 Specialist',color: '#ef4444', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'risk-analyst':  { squad: 'Governance', label: 'Risk Analyst',    color: '#ef4444', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'legal-reviewer':{ squad: 'Governance', label: 'Legal Reviewer',  color: '#ef4444', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },

  // ── Strategy ────────────────────────────────────────────────────────────────
  portfolio:         { squad: 'Strategy', label: 'Portfolio',         color: '#06b6d4', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  'b2b-sales':       { squad: 'Strategy', label: 'B2B Sales',         color: '#06b6d4', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  'business-analyst':{ squad: 'Strategy', label: 'Business Analyst',  color: '#06b6d4', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'roi-analyst':     { squad: 'Strategy', label: 'ROI Analyst',       color: '#06b6d4', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },
  'sales-engineer':  { squad: 'Strategy', label: 'Sales Engineer',    color: '#06b6d4', level: 'super-specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Pipeline Ops ──────────────────────────────────────────────────────────
  'executive-ux': { squad: 'Pipeline Ops', label: 'Executive UX', color: '#d946ef', level: 'specialist', autonomy: 'human', origin: 'built-in' },
  commandops:     { squad: 'Pipeline Ops', label: 'CommandOps',   color: '#d946ef', level: 'specialist', autonomy: 'auto',  origin: 'built-in' },

  // ── Embedded (IoT & Industrial) ─────────────────────────────────────────────
  'iot-developer':            { squad: 'Embedded', label: 'IoT Developer',            color: '#78716c', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  firmware:                   { squad: 'Embedded', label: 'Firmware',                 color: '#78716c', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  edge:                       { squad: 'Embedded', label: 'Edge',                     color: '#78716c', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  hal:                        { squad: 'Embedded', label: 'HAL',                      color: '#78716c', level: 'specialist',       autonomy: 'human', origin: 'built-in' },
  'device-test':              { squad: 'Embedded', label: 'Device Test',              color: '#78716c', level: 'specialist',       autonomy: 'auto',  origin: 'built-in' },
  'embedded-linux-developer': { squad: 'Embedded', label: 'Embedded Linux Developer', color: '#78716c', level: 'super-specialist', autonomy: 'human', origin: 'built-in' },
};
