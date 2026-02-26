# Corporate Router VPN Configuration

> Configure your office router/firewall to establish the IPsec S2S VPN tunnel to Azure.

## Connection Parameters

| Parameter | Value |
|-----------|-------|
| **Remote Gateway IP** | *(Azure VPN Gateway public IP — shown after script runs)* |
| **Pre-Shared Key** | *(same as `$SharedSecret` in the setup script)* |
| **IKE Version** | IKEv2 |
| **VPN Type** | Route-based (RouteBased) |
| **Local Networks** | `192.168.1.0/24` |
| **Remote Networks** | `10.200.0.0/16`, `10.224.0.0/12`, `10.201.0.0/16` |

## IKEv2 Phase 1 (IKE SA)

| Parameter | Value |
|-----------|-------|
| Encryption | AES-256 |
| Integrity/Hash | SHA-256 |
| DH Group | Group 14 (2048-bit MODP) |
| SA Lifetime | 28800 seconds (8 hours) |

## IKEv2 Phase 2 (IPsec SA)

| Parameter | Value |
|-----------|-------|
| Encryption | AES-256 |
| Integrity/Hash | SHA-256 |
| PFS Group | PFS2048 (Group 14) |
| SA Lifetime | 3600 seconds (1 hour) |

## Firewall Rules Required

Open these ports on the corporate firewall (outbound to Azure VPN Gateway IP):

| Port | Protocol | Purpose |
|------|----------|---------|
| 500 | UDP | IKE negotiation |
| 4500 | UDP | IPsec NAT-T |
| ESP | IP Protocol 50 | Encapsulated Security Payload |

## What Traffic Flows Through the VPN

| Source (Azure) | Destination (Corporate) | Port | Purpose |
|---------------|------------------------|------|---------|
| AKS CDC Producer pods | 192.168.1.3 | 1433 | PcGraf SQL Server polling |
| AKS CDC Health Check | 192.168.1.3 | 1433 | SQL Server health check |
| Container App (treasury-aragroupcr) | 192.168.1.3 | 1433 | ERP Schema + Data Curation endpoints |

## Network Topology After Setup

```
Corporate Office (192.168.1.0/24)
    ├── PcGraf SQL Server (192.168.1.3:1433)
    └── Office Router (public IP) ─── IPsec IKEv2 ──┐
                                                      │
Azure (eastus2)                                       │
    Hub VNet (10.200.0.0/16)                          │
        └── VPN Gateway ◄─────────────────────────────┘
            │
            ├── Peering → AKS VNet (10.224.0.0/12)
            │       ├── Kafka brokers (3x) ─── kafka namespace
            │       ├── CDC Producer (CronJob */5min) ─── treasury-cdc
            │       └── CDC Consumer (2 replicas) ─── treasury-cdc
            │
            └── Peering → CAE VNet (10.201.0.0/16)
                    └── treasury-aragroupcr (Container App)
                            ├── /data-model/erp-schema → 192.168.1.3
                            └── /data-model/curation → 192.168.1.3
```

## Verification After Setup

```powershell
# 1. Check VPN connection status (should be "Connected")
az network vpn-connection show -g rg-treasury-networking -n conn-azure-to-corporate --query connectionStatus

# 2. Check peering status (should be "Connected")
az network vnet peering list -g rg-treasury-networking --vnet-name vnet-treasury-hub -o table

# 3. Test TCP connectivity from AKS to PcGraf
kubectl run test-conn --rm -it --image=busybox -n treasury-cdc -- nc -zv 192.168.1.3 1433

# 4. Check CDC producer logs (should show successful polls)
kubectl logs -n treasury-cdc -l app=cdc-producer --tail=20

# 5. Check VPN Gateway metrics
az monitor metrics list --resource "/subscriptions/fc30746c-e06a-42e3-98ab-f7d74ab3b360/resourceGroups/rg-treasury-networking/providers/Microsoft.Network/virtualNetworkGateways/vpngw-treasury" --metric "TunnelIngressBytes" --interval PT5M
```

## Common Router Brands — Quick Config Links

- **Fortinet FortiGate**: [Azure S2S VPN](https://docs.fortinet.com/document/fortigate/7.4.0/azure-cookbook/684776)
- **Cisco ASA**: [Azure VPN Guide](https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-3rdparty-device-config-cisco-asa)
- **MikroTik**: [Azure IPsec](https://wiki.mikrotik.com/wiki/Manual:IP/IPsec)
- **Ubiquiti USG/UDM**: Settings → Networks → Site-to-Site VPN → IPsec
- **pfSense**: VPN → IPsec → Phase 1 + Phase 2

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Connection status "NotConnected" | Router not configured yet or PSK mismatch | Verify PSK and router config |
| Connection status "Connecting" | IKE negotiation failing | Check Phase 1 params match exactly |
| VPN connected but no traffic | Missing routes on corporate router | Add routes for 10.200.0.0/16, 10.224.0.0/12, 10.201.0.0/16 |
| Timeout to 192.168.1.3 from AKS | Firewall blocking return traffic | Allow Azure VNet ranges in corporate firewall |
| Peering shows "Disconnected" | Gateway not ready when peering was created | Delete and recreate peering |
