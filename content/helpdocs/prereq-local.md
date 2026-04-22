---
title: Local Machine
icon: 💻
category: User Guides
order: 8
color: g
parent: prerequisites
---

# 💻 Local Machine Requirements

For **local mode**, pipelines run on your machine via the `trigger dev` command.

---

## 📦 Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | 20+ (recommended 24) | Runtime for workers |
| **npm** | 10+ | Package management |
| **Git** | 2.30+ | Version control, sprint push |

---

## 🤖 Optional: CLI Agents

If you want to use CLI agents (instead of direct API calls), install the tools you need:

| Tool | Install Command | Used For |
|------|----------------|----------|
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` | Anthropic CLI agent |
| **Aider** | `pip install aider-chat` | Multi-provider CLI agent |
| **Codex** | `npm i -g @openai/codex` | OpenAI CLI agent |
| **Gemini CLI** | `npm i -g @anthropic-ai/gemini-cli` | Google CLI agent |

> 💡 **CLI SUBS mode** (subscription-based) only works locally — you need to be logged into the CLI tool on your machine.

---

## 🔧 Local Setup

### Using the CLI installer

```bash
# Generate a setup token from Orchestration → Local Setup
npx {{brand.cli.packageName}} init --token=<your-token>
```

This downloads the worker bundle, configures `.env`, and installs dependencies.

### Manual setup

```bash
# Clone the repository
git clone {{brand.cli.repoUrl}}.git
cd {{brand.cli.repoName}}

# Install dependencies
npm ci

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start the local worker
npx trigger.dev dev
```

### Verify your setup

```bash
npx {{brand.cli.packageName}} doctor
```

All checks should pass:
- ✅ Node.js and npm installed
- ✅ CLI tools available
- ✅ `.env` configured
- ✅ Trigger.dev connection OK
