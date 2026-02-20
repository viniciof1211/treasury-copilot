#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Provision AKS cluster for Treasury Copilot Kafka CDC pipeline
# Prerequisites: az cli logged in, kubectl installed
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
RESOURCE_GROUP="rg-treasury-copilot"
CLUSTER_NAME="aks-treasury-kafka"
LOCATION="eastus2"
NODE_COUNT=5                    # Match Kafka broker count
NODE_VM_SIZE="Standard_D4s_v3" # 4 vCPU, 16 GB RAM per node
K8S_VERSION="1.29"
ACR_NAME="acrtreasury"         # Azure Container Registry

echo "═══ Step 1: Create Resource Group ═══"
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"

echo "═══ Step 2: Create Azure Container Registry ═══"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Standard

echo "═══ Step 3: Create AKS Cluster ═══"
az aks create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CLUSTER_NAME" \
  --location "$LOCATION" \
  --node-count "$NODE_COUNT" \
  --node-vm-size "$NODE_VM_SIZE" \
  --kubernetes-version "$K8S_VERSION" \
  --network-plugin azure \
  --enable-managed-identity \
  --attach-acr "$ACR_NAME" \
  --generate-ssh-keys \
  --zones 1 2 3 \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 8 \
  --tags environment=production project=treasury-copilot component=kafka-cdc

echo "═══ Step 4: Get Credentials ═══"
az aks get-credentials \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CLUSTER_NAME" \
  --overwrite-existing

echo "═══ Step 5: Verify Cluster ═══"
kubectl get nodes -o wide
kubectl cluster-info

echo "═══ Step 6: Create Namespaces ═══"
kubectl apply -f 01-namespace.yaml

echo ""
echo "✅ AKS cluster '$CLUSTER_NAME' provisioned successfully."
echo "   Nodes: $NODE_COUNT x $NODE_VM_SIZE"
echo "   ACR:   $ACR_NAME.azurecr.io"
echo ""
echo "Next steps:"
echo "  1. Deploy Strimzi operator:  kubectl apply -f 02-strimzi-operator.yaml"
echo "  2. Deploy Kafka cluster:     kubectl apply -f 03-kafka-cluster.yaml"
echo "  3. Deploy topics:            kubectl apply -f 04-kafka-topics.yaml"
echo "  4. Build & push CDC images:  ./build-images.sh"
echo "  5. Deploy CDC workloads:     kubectl apply -f 06-cdc-producer.yaml -f 07-cdc-consumer.yaml"
