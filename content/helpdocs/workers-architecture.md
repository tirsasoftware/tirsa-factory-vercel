---
title: Workers Architecture
icon: ⚙️
category: Technical Guides
order: 102
parent: tg-architecture
color: v
---

# Workers Architecture

> Complete developer reference for how {{brand.name}} orchestrates AI agent execution through Trigger.dev workers — locally and in the cloud.

---

## Overview

{{brand.name}} uses [Trigger.dev](https://trigger.dev) as its orchestration engine. The control-plane defines **tasks** (workers) that Trigger.dev schedules and executes. These tasks can run on your machine (**local mode** via `trigger dev`) or on Trigger.dev's managed infrastructure (**cloud mode** via `trigger deploy`).

```
┌─────────────────────────┐
│   Command Center (UI)   │  ← Web application
│   POST /api/projects/run│
└──────────┬──────────────┘
           │ trigger runPipeline
           ▼
┌─────────────────────────┐
│   Trigger.dev Cloud     │  ← Orchestration scheduler
│   (task queue + routing)│
└──────────┬──────────────┘
           │ dispatch to worker
           ▼
┌─────────────────────────┐
│   Worker Environment    │  ← Local machine OR cloud container
│   run-pipeline          │
│     ├── run-agent       │  (API agents: direct LLM call)
│     └── run-cli-agent   │  (CLI agents: subprocess)
└─────────────────────────┘
```

---

## Worker Tasks

The control-plane defines **5 Trigger.dev tasks** in `services/control-plane/orchestrator/`:

### `run-pipeline` (id: `run-pipeline`)

**The main orchestrator.** Receives a project ID, loads the pipeline steps, and iterates through each step sequentially.

| Field | Description |
|-------|-------------|
| **File** | `orchestrator/run-pipeline.ts` |
| **Trigger** | Called from `/api/projects/[id]/run` when user starts a sprint |
| **Max duration** | 3600s (1 hour) |
| **Retries** | 3 attempts |

**What it does:**
1. Loads the project, pipeline steps, and settings from Supabase
2. For each step, determines routing: **API** (`run-agent`) or **CLI** (`run-cli-agent`)
3. Builds the agent input (briefing + artifact refs from previous steps)
4. Dispatches the subtask and waits for completion
5. Tracks artifacts, handles human gates, manages phase transitions
6. On completion: marks sprint as done or pending_save
7. On crash: marks project as paused, sprint as failed, emits notification

**Key payload fields:**
```typescript
{
  projectId: string;       // UUID of the project
  tenantId: string;        // Tenant for scoping
  briefing?: string;       // Sprint briefing override
  startFromStep?: number;  // Resume from specific step
  bypassGates?: boolean;   // Skip human approval gates
  provider?: string;       // LLM provider override
  model?: string;          // Model override
  stepRoutingOverrides?: Record<string, { cliOverride: { enabled: boolean; cli?: string } }>;
}
```

---

### `run-agent` (id: `run-agent`)

**Executes a single agent via LLM API call.** Spawns the agent as a `tsx` subprocess that loads the agent spec, calls the LLM, uses tools, and writes output artifacts.

| Field | Description |
|-------|-------------|
| **File** | `orchestrator/run-agent.ts` |
| **Trigger** | Called by `run-pipeline` for API-routed steps |
| **Max duration** | 600s (10 min, configurable) |
| **Retries** | 2 attempts |

**Execution flow:**
```
run-agent task
  │
  ├── Creates agent_runs record in DB (status: "queued")
  ├── Resolves provider/model from project settings
  ├── Sets environment variables (AGENT_*, SUPABASE_*, API keys)
  │
  ├── spawn("tsx", ["agents/{slug}.ts", input, projectSlug])
  │     │
  │     ├── agent-runtime.ts loads spec (DB → YAML → fallback)
  │     ├── buildSpecSystemPrompt() → system prompt
  │     ├── Calls LLM via provider SDK (Claude/Gemini/DeepSeek)
  │     ├── Tool loop: read_artifact, write_project_file, etc.
  │     └── Stages output artifact to Supabase Storage
  │
  ├── Updates agent_runs (status: "done", output_ref, cost)
  └── Returns { runId, outputRef, costUsd }
```

**Environment variables injected into subprocess:**

| Variable | Source | Purpose |
|----------|--------|---------|
| `AGENT_NAME` | Step slug | Agent identifier |
| `AGENT_STEP` | Pipeline step number | Ordering |
| `AGENT_TENANT_ID` | Project → Factory → Tenant | Tenant scoping for DB queries |
| `AGENT_PROVIDER` | Settings | LLM provider override |
| `AGENT_MODEL` | Settings | Model override |
| `AGENT_MAX_TOKENS` | Settings | Output token limit |
| `AGENT_MAX_TOOL_ROUNDS` | Settings | Tool iteration limit |
| `ANTHROPIC_API_KEY` | tenant_integrations | Claude API key |
| `OPENAI_API_KEY` | tenant_integrations | OpenAI API key |
| `GEMINI_API_KEY` | tenant_integrations | Google API key |
| `DEEPSEEK_API_KEY` | tenant_integrations | DeepSeek API key |
| `NEXT_PUBLIC_SUPABASE_URL` | Environment | Supabase endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Environment | Supabase admin access |

> **Security note:** API keys are read from `tenant_integrations` (encrypted at rest in Supabase) and injected as process environment variables. They are never logged, never included in artifact output, and never passed to the LLM as prompt content.

---

### `run-cli-agent` (id: `run-cli-agent`)

**Executes a single agent via headless CLI tool** (Claude Code, Aider, Codex, Gemini CLI). The CLI tool handles the LLM interaction internally.

| Field | Description |
|-------|-------------|
| **File** | `orchestrator/run-cli-agent.ts` |
| **Trigger** | Called by `run-pipeline` for CLI-routed steps |
| **Max duration** | 1800s (30 min) |
| **Retries** | 2 attempts |

**Supported CLIs:**

| CLI | Auth Mode | Storage |
|-----|-----------|---------|
| `claude-code` | OAuth (subscription) or API key | MCP tools → Supabase Storage |
| `aider` | API key | Filesystem → Git |
| `codex` | API key | Filesystem |
| `gemini-cli` | OAuth or API key | Filesystem |

**Execution flow:**
```
run-cli-agent task
  │
  ├── Creates agent_runs record
  ├── Clones/prepares workspace
  │
  ├── cli-executor.ts:
  │   ├── Writes .claude/agents/{slug}.md (subagent definition with persona)
  │   ├── Writes .tp/BRIEFING.md (task content)
  │   ├── Configures MCP server (if enabled)
  │   └── Spawns CLI subprocess with timeout
  │
  ├── Captures stdout, parses [ESCALATE] markers
  ├── Stages output artifact
  └── Returns { runId, outputRef, filesChanged, prUrl }
```

**CLI Agent Modes:**

| Mode | Auth | Works Local | Works Cloud | Cost |
|------|------|:-----------:|:-----------:|------|
| **CLI SUBS** | OAuth / subscription | Yes | **No** | Subscription (flat rate) |
| **CLI API** | API key from tenant_integrations | Yes | Yes | Per-token billing |

- **CLI SUBS** (`authMode: "oauth"`) — Uses the CLI's own subscription/login (e.g., Claude Pro/Max). Requires interactive OAuth login, so it **only works in local mode** where the user has already authenticated. Cannot work in cloud containers (no browser for login).
- **CLI API** (`authMode: "api-key"`) — Injects the tenant's API key into the CLI as an environment variable. Works in both local and cloud. Uses per-token billing through the provider's API.

> **Important:** When using **Cloud mode**, all steps must use either **API** routing (direct LLM call) or **CLI API** (key-based). **CLI SUBS is not available in cloud** because containers cannot perform interactive OAuth login.

---

### `index-knowledge-source` (id: `index-knowledge-source`)

**Indexes a knowledge base source** (URL, document, GitHub repo) for RAG retrieval by agents.

| Field | Description |
|-------|-------------|
| **File** | `orchestrator/index-knowledge.ts` |
| **Trigger** | Called when user adds/updates a knowledge source |

---

### `infra-readiness` (id: `infra-readiness`)

**Health check task** that validates infrastructure connectivity (Supabase, Storage, Trigger.dev API).

| Field | Description |
|-------|-------------|
| **File** | `orchestrator/infra-readiness.ts` |
| **Trigger** | Called from admin health check endpoint |

---

## Agent Spec Resolution

When an agent runs, its specification (persona, tools, capabilities) is loaded in priority order:

```
1. Database (agent_definitions.spec JSONB)  ← Primary source
   └── Queried by slug + tenantId
   └── Contains: description, output_types, tools, autonomy, guardrails

2. YAML file (agents/contracts/{slug}.yaml)  ← Filesystem fallback
   └── Only available when files are present (local mode, or additionalFiles in cloud)
   └── Contains: persona, sipoc, protocol, tools

3. Legacy .md contract (agents/contracts/{slug}.md)  ← Legacy fallback
   └── Parsed for tool extraction via regex

4. Freestyle (no spec found)  ← Best-effort
   └── Agent runs with generic instructions
```

**In local mode:** All three sources are available (DB + filesystem).
**In cloud mode:** DB is always available. Filesystem files require `additionalFiles` in `trigger.config.ts`.

---

## Artifact Flow Between Agents

Agents don't receive previous agents' output directly in their prompt. Instead:

```
Agent A executes
  └── Calls write_staging_artifact("ARCH-001.md", content)
      └── Stored in Supabase Storage: .staging/{project}/{agent}/ARCH-001.md
      └── Reference added to artifactRefs: { step: 1, agent: "architect", ref: ".staging/..." }

Agent B receives prompt with:
  "## Required Inputs
   - .staging/{project}/architect/ARCH-001.md (from step 1)"
  └── Agent calls read_artifact(".staging/{project}/architect/ARCH-001.md")
      └── Reads content from Supabase Storage on demand
```

**Tools available to agents:**

| Tool | Purpose | Storage Backend |
|------|---------|----------------|
| `read_artifact` | Read output from previous agents | Supabase Storage or local |
| `list_artifacts` | List available artifacts | Supabase Storage or local |
| `write_staging_artifact` | Write sprint deliverable | Supabase Storage or local |
| `read_project_file` | Read committed project file | Supabase Storage or local |
| `write_project_file` | Write project file (src, docs, etc.) | Supabase Storage or local |
| `list_project_files` | List project files | Supabase Storage or local |
| `escalate_to_human` | Pause pipeline for human review | DB event |
| `github_push_sprint` | Push sprint output to GitHub | GitHub API |

---

## Storage Backends

| Backend | When Used | Path Pattern |
|---------|-----------|-------------|
| **Supabase Storage** | Cloud mode, default | `{tenantId}/{projectId}/.staging/{agent}/` |
| **Local filesystem** | Local mode, `execution_backend: "local"` | `{localBasePath}/{projectSlug}/.staging/{agent}/` |
| **GitHub** | Sprint push (output destination) | Branch: `sprint/{sprintNum}` |

The storage backend is configured per-project in Project Settings → Storage. Agents use the same tool API regardless of backend — the runtime resolves the path transparently.

---

## Local vs Cloud: Key Differences

| Aspect | Local (`trigger dev`) | Cloud (`trigger deploy`) |
|--------|----------------------|--------------------------|
| **Where tasks run** | Your machine | Trigger.dev cloud containers |
| **Agent files** | Full filesystem available | Only files in `additionalFiles` |
| **CLI tools** | Installed on your machine | Must be in Docker image |
| **API keys** | From `.env` or `tenant_integrations` | From `tenant_integrations` only |
| **Storage** | Local filesystem or Supabase | Supabase Storage only |
| **CLI subscriptions** | Available (user has OAuth session) | **Not available** (no interactive login in container) |
| **Hot reload** | Yes — code changes apply immediately | No — requires redeploy |
| **Max duration** | Unlimited (dev) | 3600s per task |
| **Cost** | Free (your machine) | Trigger.dev usage-based pricing |

---

## Build & Deploy

### Local Development

```bash
# Install dependencies
npm ci

# Start Trigger.dev dev server (connects to cloud scheduler)
npx trigger.dev dev

# Your .env must have:
TRIGGER_DEV_SECRET_KEY=tr_dev_...
TRIGGER_PROJECT_ID=proj_...
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### Cloud Deploy

```bash
# Dry-run (validates build without deploying)
npx trigger.dev deploy --dry-run

# Full deploy
npx trigger.dev deploy
```

Or via the UI: **Orchestration → Deploy Workers**

### `trigger.config.ts`

```typescript
import { defineConfig } from "@trigger.dev/sdk/v3";
import { additionalPackages, additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID,
  dirs: ["services/control-plane/orchestrator"],  // Task entry points
  maxDuration: 3600,

  build: {
    extensions: [
      // tsx is needed to spawn agent .ts files as subprocesses
      additionalPackages({ packages: ["tsx"] }),

      // Files that must exist on disk (not bundled by esbuild)
      additionalFiles({ files: [
        "services/control-plane/agents/**",    // Agent entry scripts
        "services/control-plane/lib/**",       // Runtime libraries
        "services/control-plane/config/**",    // Provider config
        "agents/contracts/**",                 // YAML specs (fallback)
      ]}),
    ],

    // Custom Docker image with CLI tools pre-installed
    // Includes: Claude Code, Aider (Python), Codex, git, Node.js 24
    // CLIs in cloud only work with API key auth (not subscriptions)
    image: {
      reference: "ghcr.io/tirsasoftware/tirsa-factory-worker:latest",
    },
  },
});
```

**Key concepts:**
- `dirs` — Trigger.dev scans this directory for `task()` exports. These become the bundled entry points.
- `additionalPackages` — npm packages installed in the worker container (not just bundled). `tsx` is required because `run-agent` spawns agent scripts as child processes.
- `additionalFiles` — Source files copied to the worker filesystem. Required because agent `.ts` files are spawned (not imported) and need their import chain intact.
- `image` — Custom Docker image that includes non-npm tools (Claude Code, Aider, Codex).

---

## Security

### Sensitive Data in Workers

| Data | Where Stored | How Accessed | Exposure |
|------|-------------|--------------|----------|
| **LLM API keys** | `tenant_integrations` (Supabase) | Read at runtime, injected as env vars | Process-only, never logged |
| **Supabase service key** | Worker environment | Env var | Used for DB/Storage access |
| **GitHub tokens** | `tenant_integrations` | Read at runtime for push operations | Process-only |
| **Telegram bot tokens** | `notification_channel_config` | Read for notification dispatch | Process-only |
| **User briefings** | `projects.intake_brief` | Read from DB, passed as agent input | In LLM prompt |
| **Artifact content** | Supabase Storage | Read/written via tools | In LLM context |

### Tenant Isolation

- Each worker task receives `tenantId` in its payload
- DB queries are scoped by `tenant_id`
- Storage paths include `tenantId` as prefix
- API keys are read from the specific tenant's `tenant_integrations`
- **Workers never access data from other tenants**

### API Endpoint Security

All Command Center API endpoints that trigger workers require:
1. `Authorization: Bearer {jwt}` header (Supabase Auth token)
2. `tenant_members` verification (user must belong to the tenant)
3. Role check for destructive operations (owner/admin only)

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `spawn tsx ENOENT` | `tsx` not installed in worker | Add `additionalPackages({ packages: ["tsx"] })` to `trigger.config.ts` |
| `ERR_MODULE_NOT_FOUND: agents/_custom.ts` | Agent files not in worker filesystem | Add `additionalFiles({ files: ["services/control-plane/agents/**"] })` |
| `Unknown provider: anthropic` | Invalid provider name | Use `claude` not `anthropic` in project settings |
| `Unauthorized` on deploy | Missing or expired `GITHUB_ADMIN_TOKEN` | Update token in Admin → Integrations |
| `Pipeline halted: {agent} failed` | Agent subprocess exited with error | Check agent logs in Trigger.dev dashboard |
| Status stuck "Initializing" | Pipeline crashed before updating status | Check `run-pipeline` logs; crash handler should set status to paused |

### Debugging

```bash
# View local worker logs in real-time
npx trigger.dev dev

# Check cloud worker logs
# Go to https://cloud.trigger.dev → Runs → select the run

# Dry-run deploy to check build output
npx trigger.dev deploy --dry-run
# Check built files at .trigger/tmp/build-*/
```

---

## File Reference

| File | Purpose |
|------|---------|
| `trigger.config.ts` | Trigger.dev project configuration |
| `orchestrator/run-pipeline.ts` | Pipeline orchestrator task |
| `orchestrator/run-agent.ts` | API agent executor task |
| `orchestrator/run-cli-agent.ts` | CLI agent executor task |
| `orchestrator/index-knowledge.ts` | Knowledge base indexer task |
| `orchestrator/infra-readiness.ts` | Infrastructure health check task |
| `lib/agent-runtime.ts` | Agent execution engine (spec loading, LLM call, tools) |
| `lib/agent-spec.ts` | Agent spec loader (DB + YAML) |
| `lib/cli-executor.ts` | CLI subprocess manager |
| `lib/tool-registry.ts` | Tool definitions and resolution |
| `lib/providers/claude.ts` | Claude API provider |
| `lib/providers/gemini.ts` | Gemini API provider |
| `lib/providers/deepseek.ts` | DeepSeek API provider |
| `lib/supabase.ts` | Supabase client factory |
| `lib/notify.ts` | Notification dispatcher |
| `agents/*.ts` | Agent entry scripts (spawned by run-agent) |
| `agents/contracts/*.yaml` | Agent YAML specs (filesystem fallback) |
| `config/agent-providers.json` | Default provider/model per agent |
| `.github/workflows/deploy-tasks.yml` | CI workflow for cloud deploy |
