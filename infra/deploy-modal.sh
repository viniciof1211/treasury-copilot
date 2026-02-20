#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Deploy Treasury Copilot agents to Modal
# Deploys all 3 Modal apps:
#   1. treasury-copilot-agent (root agent + unified FAISS KB)
#   2. treasury-analytics-agent
#   3. treasury-data-service-agent
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "═══ Modal Deployment — Treasury Copilot ═══"
echo ""

# ── Step 1: Deploy root agent (includes unified FAISS KB) ─────────────────
echo "Step 1/3: Deploying treasury-copilot-agent (root + KB)..."
modal deploy agent/modal_app.py
echo "  ✅ Root agent deployed"
echo "  URL: https://levinnovation--treasury-copilot-agent-web.modal.run"

# ── Step 2: Deploy analytics agent ────────────────────────────────────────
echo ""
echo "Step 2/3: Deploying treasury-analytics-agent..."
modal deploy agent/modal_analytics.py
echo "  ✅ Analytics agent deployed"
echo "  URL: https://levinnovation--treasury-analytics-agent-web.modal.run"

# ── Step 3: Deploy data service agent ─────────────────────────────────────
echo ""
echo "Step 3/3: Deploying treasury-data-service-agent..."
modal deploy agent/modal_data_service.py
echo "  ✅ Data service agent deployed"
echo "  URL: https://levinnovation--treasury-data-service-agent-web.modal.run"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ All 3 Modal apps deployed successfully!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Verify:"
echo "  curl https://levinnovation--treasury-copilot-agent-web.modal.run/health"
echo "  curl https://levinnovation--treasury-copilot-agent-web.modal.run/kb/stats"
echo ""
echo "KB endpoints:"
echo "  POST /kb/search       — search unified KB"
echo "  POST /kb/sync         — trigger full sync (all sources)"
echo "  GET  /kb/stats        — sync statistics"
echo "  POST /kb/cdc_refresh  — CDC-triggered incremental refresh"
echo "  POST /kb/upload       — upload and index a file"
