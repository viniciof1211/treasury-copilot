#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Build, push, and deploy Treasury Copilot to Azure Container Apps
# Uses existing ACR and Container App from memory:
#   ACR: cr6uluhllxv7asm.azurecr.io
#   App: treasury-aragroupcr
#   RG:  rg-cocinas-prod
#   Env: cae-6uluhllxv7asm
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ACR_NAME="cr6uluhllxv7asm"
ACR_URL="${ACR_NAME}.azurecr.io"
IMAGE_NAME="treasury-copilot-agent"
TAG="${TAG:-latest}"
RESOURCE_GROUP="rg-cocinas-prod"
APP_NAME="treasury-aragroupcr"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "═══ Treasury Copilot — Container App Deployment ═══"
echo "  ACR:  ${ACR_URL}"
echo "  App:  ${APP_NAME}"
echo "  Tag:  ${TAG}"
echo ""

# ── Step 1: Login to ACR ──────────────────────────────────────────────────
echo "Step 1/4: Logging into ACR..."
az acr login --name "$ACR_NAME"

# ── Step 2: Build Docker image ────────────────────────────────────────────
echo "Step 2/4: Building Docker image..."
docker build \
  -t "${ACR_URL}/${IMAGE_NAME}:${TAG}" \
  -f "${REPO_ROOT}/agent/Dockerfile" \
  --build-arg BUILD_DATE="$(date +%Y-%m-%d-v%H%M)" \
  "${REPO_ROOT}"

# ── Step 3: Push to ACR ──────────────────────────────────────────────────
echo "Step 3/4: Pushing to ACR..."
docker push "${ACR_URL}/${IMAGE_NAME}:${TAG}"

# ── Step 4: Update Container App ─────────────────────────────────────────
echo "Step 4/4: Updating Container App..."
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "${ACR_URL}/${IMAGE_NAME}:${TAG}" \
  --set-env-vars \
    "KAFKA_BOOTSTRAP_SERVERS=treasury-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092" \
    "KB_SYNC_INTERVAL=240"

echo ""
echo "✅ Deployment complete!"
echo "   URL: https://${APP_NAME}.grayhill-769056ba.eastus2.azurecontainerapps.io"
echo "   Image: ${ACR_URL}/${IMAGE_NAME}:${TAG}"
