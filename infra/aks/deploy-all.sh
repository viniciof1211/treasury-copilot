#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Deploy entire Kafka CDC pipeline to AKS
# Usage: ./deploy-all.sh
# Prerequisites:
#   - az cli logged in
#   - kubectl configured to target AKS cluster
#   - Docker images built and pushed to ACR
#   - Strimzi operator installed
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "═══════════════════════════════════════════════════════════════"
echo "  Treasury Copilot — Kafka CDC Pipeline Deployment"
echo "═══════════════════════════════════════════════════════════════"

echo ""
echo "Step 1/7: Creating namespaces..."
kubectl apply -f 01-namespace.yaml

echo ""
echo "Step 2/7: Installing Strimzi operator..."
echo "  (If not already installed, run:)"
echo "  kubectl create -f https://strimzi.io/install/latest?namespace=kafka"
kubectl apply -f 02-strimzi-operator.yaml

echo ""
echo "Step 3/7: Waiting for Strimzi operator to be ready..."
kubectl wait --for=condition=Available deployment/strimzi-cluster-operator \
  -n kafka --timeout=120s 2>/dev/null || echo "  (Strimzi operator may need manual install — see 02-strimzi-operator.yaml)"

echo ""
echo "Step 4/7: Deploying Kafka cluster (5 brokers, RF=5)..."
kubectl apply -f 03-kafka-cluster.yaml
echo "  Waiting for Kafka cluster to be ready (this may take 3-5 minutes)..."
kubectl wait kafka/treasury-kafka --for=condition=Ready \
  -n kafka --timeout=600s 2>/dev/null || echo "  (Kafka cluster still provisioning — check: kubectl get kafka -n kafka)"

echo ""
echo "Step 5/7: Creating Kafka topics (23 CDC topics + DLQ)..."
kubectl apply -f 04-kafka-topics.yaml

echo ""
echo "Step 6/7: Creating secrets and config..."
kubectl apply -f 05-secrets.yaml

echo ""
echo "Step 7/7: Deploying CDC workloads..."
kubectl apply -f 06-cdc-producer.yaml
kubectl apply -f 07-cdc-consumer.yaml
kubectl apply -f 08-monitoring.yaml

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Verify:"
echo "  kubectl get kafka -n kafka"
echo "  kubectl get kafkatopics -n kafka"
echo "  kubectl get pods -n kafka"
echo "  kubectl get pods -n treasury-cdc"
echo "  kubectl get cronjobs -n treasury-cdc"
echo ""
echo "Kafka bootstrap (internal):"
echo "  treasury-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092"
echo ""
echo "Logs:"
echo "  kubectl logs -n treasury-cdc -l app.kubernetes.io/name=cdc-producer -f"
echo "  kubectl logs -n treasury-cdc -l app.kubernetes.io/name=cdc-consumer -f"
