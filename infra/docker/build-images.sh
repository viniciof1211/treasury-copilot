#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Build and push CDC Docker images to Azure Container Registry
# Usage: ./build-images.sh [--push]
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ACR_NAME="${ACR_NAME:-acrtreasury}"
ACR_URL="${ACR_NAME}.azurecr.io"
TAG="${TAG:-latest}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "═══ Building CDC images ═══"
echo "  ACR:  $ACR_URL"
echo "  Tag:  $TAG"
echo "  Root: $REPO_ROOT"
echo ""

# ── CDC Producer ───────────────────────────────────────────────────────────
echo "── Building cdc-producer ──"
docker build \
  -t "${ACR_URL}/cdc-producer:${TAG}" \
  -f "${REPO_ROOT}/infra/docker/Dockerfile.cdc-producer" \
  "${REPO_ROOT}"

# ── CDC Consumer ───────────────────────────────────────────────────────────
echo "── Building cdc-consumer ──"
docker build \
  -t "${ACR_URL}/cdc-consumer:${TAG}" \
  -f "${REPO_ROOT}/infra/docker/Dockerfile.cdc-consumer" \
  "${REPO_ROOT}"

echo ""
echo "✅ Images built successfully:"
echo "   ${ACR_URL}/cdc-producer:${TAG}"
echo "   ${ACR_URL}/cdc-consumer:${TAG}"

# ── Push to ACR ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--push" ]]; then
  echo ""
  echo "═══ Logging into ACR ═══"
  az acr login --name "$ACR_NAME"

  echo "═══ Pushing images ═══"
  docker push "${ACR_URL}/cdc-producer:${TAG}"
  docker push "${ACR_URL}/cdc-consumer:${TAG}"

  echo ""
  echo "✅ Images pushed to ${ACR_URL}"
else
  echo ""
  echo "To push: $0 --push"
fi
