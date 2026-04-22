---
title: Orchestration
icon: ⚙️
category: User Guides
order: 13
color: v
parent: integrations
---

# ⚙️ Orchestration

Trigger.dev powers the pipeline execution engine. Configure it in the **Orchestration** page.

---

## 🔧 Configuration

| Field | What it does |
|-------|-------------|
| **Project ID** | Links to your Trigger.dev project (`proj_...`) |
| **Dev Secret Key** | Authenticates local workers (`tr_dev_...`) |
| **Prod Secret Key** | Authenticates cloud workers (`tr_prod_...`) |
| **Access Token** | Used for deploying workers via GitHub Actions |

## ▶️ Local Mode

Run `trigger dev` on your machine — tasks execute locally.

```bash
npx {{brand.cli.packageName}} dev
# or
npx trigger.dev dev
```

- ✅ Hot reload — code changes apply immediately
- ✅ CLI subscriptions available (no API keys needed)
- ✅ Local filesystem access

## ☁️ Cloud Mode

Deploy workers to Trigger.dev cloud — tasks execute in managed containers.

1. **Sync Environment Variables** — Push required vars to Trigger.dev
2. **Deploy Workers** — Dispatches GitHub Actions workflow
3. Tasks run in a Docker container with CLI tools pre-installed

- ✅ No local machine needed
- ✅ Scalable and always available
- ⚠️ Requires LLM API keys (no CLI subscriptions)

## 🔄 Environment Variable Sync

The **Env Sync** section shows variables needed by your workers. Click **Sync** to push them to Trigger.dev automatically.

## 📊 Deploy Status

After deploying, monitor the workflow status. The badge shows: **queued → in_progress → success/failure**.
