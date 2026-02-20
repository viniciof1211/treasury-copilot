# Treasury Copilot — Kafka CDC Infrastructure on AKS

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────────────────┐
│  PcGraf ERP     │     │  Azure Kubernetes Service (AKS)                  │
│  SQL Server     │     │                                                  │
│  192.168.1.3    │     │  ┌─────────────────────────────────────────────┐ │
│  siawin0        │◄────┤  │  namespace: treasury-cdc                    │ │
│                 │     │  │                                             │ │
│  23 tables      │     │  │  ┌─────────────┐    ┌──────────────────┐   │ │
│  tracked by CDC │     │  │  │ CDC Producer │───►│  CDC Consumer    │   │ │
└─────────────────┘     │  │  │ (CronJob     │    │  (Deployment x2) │   │ │
                        │  │  │  every 5min) │    │  auto-scales 2-5 │   │ │
                        │  │  └──────┬───────┘    └────────┬─────────┘   │ │
                        │  └─────────┼─────────────────────┼─────────────┘ │
                        │            │                     │               │
                        │  ┌─────────▼─────────────────────▼─────────────┐ │
                        │  │  namespace: kafka                           │ │
                        │  │                                             │ │
                        │  │  Strimzi Kafka Cluster: treasury-kafka      │ │
                        │  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐       │ │
                        │  │  │ B0 │ │ B1 │ │ B2 │ │ B3 │ │ B4 │       │ │
                        │  │  └────┘ └────┘ └────┘ └────┘ └────┘       │ │
                        │  │  5 brokers, RF=5, min.isr=3                │ │
                        │  │  23 topics (siawin0.*) + 1 DLQ             │ │
                        │  │                                             │ │
                        │  │  ZooKeeper: 3 nodes                        │ │
                        │  └─────────────────────────────────────────────┘ │
                        └──────────────────────────────────────────────────┘
                                           │
                                           ▼
                        ┌──────────────────────────────────┐
                        │  Supabase (tms schema)           │
                        │  14 canonical entities           │
                        │  + cdc_events + cdc_watermarks   │
                        │  + table_registry                │
                        └──────────────────────────────────┘
```

## Data Flow

1. **CDC Producer** (CronJob, every 5 min) polls PcGraf SQL Server for changes
2. Changes are **double-committed**:
   - Written to **Supabase** `tms.cdc_events` (immutable log)
   - Published to **Kafka** topic `siawin0.{TABLE_NAME}`
3. **CDC Consumer** (Deployment, 2-5 replicas) subscribes to all Kafka topics
4. Consumer maps PcGraf columns → canonical TMS fields → upserts to Supabase

## Cluster Specs

| Component       | Replicas | Storage | CPU   | Memory |
|-----------------|----------|---------|-------|--------|
| Kafka Broker    | 5        | 50Gi    | 1-2   | 2-4Gi  |
| ZooKeeper       | 3        | 20Gi    | 0.5-1 | 1-2Gi  |
| CDC Producer    | 1 (cron) | —       | 0.25  | 256Mi  |
| CDC Consumer    | 2-5 (HPA)| —       | 0.25  | 256Mi  |
| AKS Nodes       | 5        | —       | 4     | 16Gi   |

## Kafka Configuration

- **Brokers**: 5 (one per AKS node, anti-affinity enforced)
- **Replication Factor**: 5 (every partition replicated to all brokers)
- **Min In-Sync Replicas**: 3 (tolerates 2 broker failures)
- **Partitions per topic**: 5
- **Retention**: 7 days / 10GB per partition
- **Compression**: LZ4
- **Image**: `quay.io/strimzi/kafka:0.43.0-kafka-3.7.1`

## Deployment Steps

```bash
# 1. Provision AKS cluster
./aks/00-provision-aks.sh

# 2. Install Strimzi operator
kubectl create -f https://strimzi.io/install/latest?namespace=kafka

# 3. Build & push Docker images
./docker/build-images.sh --push

# 4. Deploy everything
./aks/deploy-all.sh

# 5. Verify
kubectl get kafka -n kafka
kubectl get kafkatopics -n kafka
kubectl get pods -n kafka
kubectl get pods -n treasury-cdc
```

## Files

```
infra/
├── aks/
│   ├── 00-provision-aks.sh          # AKS cluster provisioning (az CLI)
│   ├── 01-namespace.yaml            # kafka + treasury-cdc namespaces
│   ├── 02-strimzi-operator.yaml     # Strimzi install instructions
│   ├── 03-kafka-cluster.yaml        # Kafka CR: 5 brokers, 3 ZK, RF=5
│   ├── 04-kafka-topics.yaml         # 23 CDC topics + DLQ, all RF=5
│   ├── 05-secrets.yaml              # PcGraf + Supabase credentials
│   ├── 06-cdc-producer.yaml         # CronJob (5min) + Daemon Deployment
│   ├── 07-cdc-consumer.yaml         # Consumer Deployment + HPA
│   ├── 08-monitoring.yaml           # PodMonitor, health checks, NetworkPolicy
│   └── deploy-all.sh                # One-click deploy script
├── docker/
│   ├── Dockerfile.cdc-producer      # CDC producer image
│   ├── Dockerfile.cdc-consumer      # CDC consumer image
│   └── build-images.sh              # Build & push to ACR
└── README.md                        # This file
```

## Monitoring

- **Kafka metrics**: JMX → Prometheus via Strimzi PodMonitor
- **CDC health**: CronJob every 10 min checks PcGraf + Kafka connectivity
- **Consumer lag**: Monitor via `kafka-consumer-groups.sh --describe`
- **Logs**: `kubectl logs -n treasury-cdc -l app.kubernetes.io/component=cdc -f`

## Security

- Secrets stored in K8s Secrets (migrate to Azure Key Vault for production)
- NetworkPolicy restricts Kafka access to `treasury-cdc` namespace only
- PcGraf credentials never exposed outside the cluster
- Kafka TLS listener available on port 9093
