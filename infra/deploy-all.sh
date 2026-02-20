#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Master deployment script — deploys EVERYTHING:
#   1. Kafka cluster on AKS (5 brokers, RF=5)
#   2. CDC Docker images to ACR
#   3. CDC workloads to AKS (producer CronJob + consumer Deployment)
#   4. Web app to Azure Container Apps
#   5. All 3 Modal agents (root + analytics + data service)
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "═══════════════════════════════════════════════════════════════"
echo "  Treasury Copilot — Full Stack Deployment"
echo "  $(date)"
echo "═══════════════════════════════════════════════════════════════"

# ── Phase 1: AKS + Kafka ──────────────────────────────────────────────────
echo ""
echo "╔══ Phase 1: Kafka Cluster on AKS ══╗"
echo ""
echo "Step 1a: Provisioning AKS cluster (if needed)..."
# Uncomment if cluster doesn't exist yet:
# bash "$SCRIPT_DIR/aks/00-provision-aks.sh"

echo "Step 1b: Deploying Kafka cluster + topics..."
bash "$SCRIPT_DIR/aks/deploy-all.sh"

# ── Phase 2: CDC Docker Images ────────────────────────────────────────────
echo ""
echo "╔══ Phase 2: CDC Docker Images ══╗"
echo ""
echo "Step 2: Building and pushing CDC images to ACR..."
bash "$SCRIPT_DIR/docker/build-images.sh" --push

# ── Phase 3: Web App to Container Apps ────────────────────────────────────
echo ""
echo "╔══ Phase 3: Web App → Azure Container Apps ══╗"
echo ""
echo "Step 3: Building and deploying web app..."
bash "$SCRIPT_DIR/deploy-container-app.sh"

# ── Phase 4: Modal Agents ─────────────────────────────────────────────────
echo ""
echo "╔══ Phase 4: Modal Agents (root + analytics + data service) ══╗"
echo ""
echo "Step 4: Deploying all 3 Modal apps..."
bash "$SCRIPT_DIR/deploy-modal.sh"

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ FULL DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Services:"
echo "  Web App:     https://treasury-aragroupcr.grayhill-769056ba.eastus2.azurecontainerapps.io"
echo "  Root Agent:  https://levinnovation--treasury-copilot-agent-web.modal.run"
echo "  Analytics:   https://levinnovation--treasury-analytics-agent-web.modal.run"
echo "  Data Svc:    https://levinnovation--treasury-data-service-agent-web.modal.run"
echo "  Kafka:       treasury-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092"
echo ""
echo "Verify:"
echo "  curl https://treasury-aragroupcr.grayhill-769056ba.eastus2.azurecontainerapps.io/health"
echo "  curl https://levinnovation--treasury-copilot-agent-web.modal.run/kb/stats"
echo "  kubectl get kafka -n kafka"
echo "  kubectl get pods -n treasury-cdc"
