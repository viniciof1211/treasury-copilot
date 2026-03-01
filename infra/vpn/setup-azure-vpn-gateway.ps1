###############################################################################
# Azure Site-to-Site VPN Gateway Setup
# Connects Azure (AKS + Container Apps) to Corporate LAN (192.168.1.0/24)
#
# Architecture:
#   Corporate LAN (192.168.1.0/24)  <-- IPsec S2S VPN -->  Azure VPN Gateway
#       └── PcGraf SQL Server (192.168.1.3:1433)
#
#   Azure Side:
#     ┌─ Hub VNet (10.200.0.0/16) ── VPN Gateway + GatewaySubnet
#     │     │
#     │     ├── Peering ──> AKS VNet (10.224.0.0/12)
#     │     │                  ├── aks-subnet (10.224.0.0/16) ── Kafka brokers, CDC pods
#     │     │                  ├── aks-appgateway (10.238.0.0/24)
#     │     │                  └── aks-virtualkubelet (10.239.0.0/16)
#     │     │
#     │     └── Peering ──> Container Apps VNet (10.201.0.0/16)
#     │                        └── cae-subnet (10.201.0.0/23) ── treasury-aragroupcr
#     │
#     └── Local Network Gateway ── represents corporate router public IP
#
# Prerequisites:
#   - Azure CLI logged in (az login)
#   - Subscription: DEV-SANDBOX - SDAI Ara (fc30746c-e06a-42e3-98ab-f7d74ab3b360)
#   - Corporate router must support IPsec IKEv2 VPN
#   - You need your corporate router's PUBLIC IP address
#
# Estimated cost: ~$27/month for VpnGw1 SKU
# Estimated provisioning time: 30-45 minutes for the VPN Gateway
###############################################################################

#Requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION — EDIT THESE VALUES
# ═══════════════════════════════════════════════════════════════════════════════

# Your corporate router's PUBLIC IP (the WAN-facing IP of your office router)
# Run: curl ifconfig.me   from a machine on the corporate network to find it
$CorporatePublicIP = "190.14.153.231"  # e.g., "201.192.xxx.xxx"

# Shared secret for IPsec tunnel (generate a strong random string)
# Both sides (Azure + corporate router) must use the same key
$SharedSecret = "Master2025"  # CHANGE THIS to a strong secret

# Corporate LAN address spaces that Azure should route to
$CorporateLANPrefixes = @(
    "192.168.1.0/24"    # Main LAN where PcGraf SQL Server (192.168.1.3) lives
    # Add more subnets if needed, e.g.:
    # "192.168.2.0/24"  # Secondary LAN
    # "10.0.0.0/24"     # Other internal network
)

# ═══════════════════════════════════════════════════════════════════════════════
# AZURE RESOURCE CONFIGURATION (derived from existing infrastructure)
# ═══════════════════════════════════════════════════════════════════════════════

$SubscriptionId       = "fc30746c-e06a-42e3-98ab-f7d74ab3b360"
$Location             = "eastus2"

# Resource groups
$HubRG                = "rg-treasury-networking"     # New RG for hub networking
$AksNodeRG            = "MC_rg-treasury-copilot_aks-treasury-kafka_eastus2"
$ContainerAppsRG      = "rg-cocinas-prod"

# Existing AKS VNet
$AksVNetName          = "aks-vnet-41722722"
$AksVNetId            = "/subscriptions/$SubscriptionId/resourceGroups/$AksNodeRG/providers/Microsoft.Network/virtualNetworks/$AksVNetName"

# Hub VNet (NEW — will host the VPN Gateway)
$HubVNetName          = "vnet-treasury-hub"
$HubVNetPrefix        = "10.200.0.0/16"
$GatewaySubnetPrefix  = "10.200.0.0/27"    # /27 = 32 IPs, minimum for VPN GW

# Container Apps VNet (NEW — to VNet-integrate the Container Apps environment)
$CaeVNetName          = "vnet-treasury-cae"
$CaeVNetPrefix        = "10.201.0.0/16"
$CaeSubnetName        = "cae-infra-subnet"
$CaeSubnetPrefix      = "10.201.0.0/23"    # /23 = 512 IPs, required minimum for CAE

# VPN Gateway resources
$VpnGwName            = "vpngw-treasury"
$VpnGwPublicIPName    = "pip-vpngw-treasury"
$LocalNetworkGwName   = "lgw-corporate-lan"
$ConnectionName       = "conn-azure-to-corporate"

# Container Apps environment
$CaeEnvName           = "cae-6uluhllxv7asm"

# ═══════════════════════════════════════════════════════════════════════════════
# VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Azure Site-to-Site VPN Gateway Setup" -ForegroundColor Cyan
Write-Host "  Corporate LAN → Azure (AKS + Container Apps)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($CorporatePublicIP -eq "YOUR_CORPORATE_PUBLIC_IP_HERE") {
    Write-Host "ERROR: You must set `$CorporatePublicIP to your office router's public IP." -ForegroundColor Red
    Write-Host "  Run 'curl ifconfig.me' from a machine on the corporate network." -ForegroundColor Yellow
    Write-Host "  Then edit this script and set the value." -ForegroundColor Yellow
    exit 1
}

Write-Host "Configuration Summary:" -ForegroundColor Green
Write-Host "  Subscription:       $SubscriptionId"
Write-Host "  Location:           $Location"
Write-Host "  Corporate Public IP: $CorporatePublicIP"
Write-Host "  Corporate LAN:      $($CorporateLANPrefixes -join ', ')"
Write-Host "  Hub VNet:           $HubVNetPrefix"
Write-Host "  AKS VNet:           10.224.0.0/12 (existing)"
Write-Host "  CAE VNet:           $CaeVNetPrefix (new)"
Write-Host "  VPN Gateway SKU:    VpnGw1 (~`$27/month)"
Write-Host ""

$confirm = Read-Host "Proceed with setup? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# Set subscription
az account set --subscription $SubscriptionId

###############################################################################
# STEP 1: Create Hub Resource Group
###############################################################################
Write-Host ""
Write-Host "══ STEP 1/9: Create Hub Resource Group ══" -ForegroundColor Cyan

az group create `
    --name $HubRG `
    --location $Location `
    --tags "project=treasury-copilot" "purpose=vpn-hub-networking" `
    --output none

Write-Host "  ✓ Resource group '$HubRG' created" -ForegroundColor Green

###############################################################################
# STEP 2: Create Hub VNet with GatewaySubnet
###############################################################################
Write-Host ""
Write-Host "══ STEP 2/9: Create Hub VNet with GatewaySubnet ══" -ForegroundColor Cyan

az network vnet create `
    --resource-group $HubRG `
    --name $HubVNetName `
    --location $Location `
    --address-prefixes $HubVNetPrefix `
    --subnet-name "GatewaySubnet" `
    --subnet-prefixes $GatewaySubnetPrefix `
    --tags "project=treasury-copilot" `
    --output none

Write-Host "  ✓ Hub VNet '$HubVNetName' ($HubVNetPrefix) created" -ForegroundColor Green
Write-Host "  ✓ GatewaySubnet ($GatewaySubnetPrefix) created" -ForegroundColor Green

###############################################################################
# STEP 3: Create Container Apps VNet
###############################################################################
Write-Host ""
Write-Host "══ STEP 3/9: Create Container Apps VNet ══" -ForegroundColor Cyan

az network vnet create `
    --resource-group $HubRG `
    --name $CaeVNetName `
    --location $Location `
    --address-prefixes $CaeVNetPrefix `
    --subnet-name $CaeSubnetName `
    --subnet-prefixes $CaeSubnetPrefix `
    --tags "project=treasury-copilot" `
    --output none

Write-Host "  ✓ CAE VNet '$CaeVNetName' ($CaeVNetPrefix) created" -ForegroundColor Green
Write-Host "  ✓ CAE Subnet '$CaeSubnetName' ($CaeSubnetPrefix) created" -ForegroundColor Green

###############################################################################
# STEP 4: Create VPN Gateway Public IP
###############################################################################
Write-Host ""
Write-Host "══ STEP 4/9: Create VPN Gateway Public IP ══" -ForegroundColor Cyan

az network public-ip create `
    --resource-group $HubRG `
    --name $VpnGwPublicIPName `
    --location $Location `
    --allocation-method Static `
    --sku Standard `
    --tags "project=treasury-copilot" `
    --output none

$vpnGwPublicIP = az network public-ip show `
    --resource-group $HubRG `
    --name $VpnGwPublicIPName `
    --query "ipAddress" --output tsv

Write-Host "  ✓ Public IP '$VpnGwPublicIPName' created: $vpnGwPublicIP" -ForegroundColor Green

###############################################################################
# STEP 5: Create VPN Gateway (takes 30-45 minutes!)
###############################################################################
Write-Host ""
Write-Host "══ STEP 5/9: Create VPN Gateway ══" -ForegroundColor Cyan
Write-Host "  ⏳ This takes 30-45 minutes. Go grab a coffee..." -ForegroundColor Yellow

az network vnet-gateway create `
    --resource-group $HubRG `
    --name $VpnGwName `
    --location $Location `
    --vnet $HubVNetName `
    --gateway-type Vpn `
    --vpn-type RouteBased `
    --sku VpnGw1 `
    --generation Generation1 `
    --public-ip-addresses $VpnGwPublicIPName `
    --no-wait `
    --tags "project=treasury-copilot" `
    --output none

Write-Host "  ✓ VPN Gateway '$VpnGwName' provisioning started (async)" -ForegroundColor Green
Write-Host "  ⏳ Waiting for VPN Gateway to be provisioned..." -ForegroundColor Yellow

# Wait for the gateway to be provisioned
az network vnet-gateway wait `
    --resource-group $HubRG `
    --name $VpnGwName `
    --created

Write-Host "  ✓ VPN Gateway '$VpnGwName' is ready!" -ForegroundColor Green

###############################################################################
# STEP 6: Create Local Network Gateway (represents corporate router)
###############################################################################
Write-Host ""
Write-Host "══ STEP 6/9: Create Local Network Gateway ══" -ForegroundColor Cyan

az network local-gateway create `
    --resource-group $HubRG `
    --name $LocalNetworkGwName `
    --location $Location `
    --gateway-ip-address $CorporatePublicIP `
    --local-address-prefixes $CorporateLANPrefixes `
    --tags "project=treasury-copilot" `
    --output none

Write-Host "  ✓ Local Network Gateway '$LocalNetworkGwName' created" -ForegroundColor Green
Write-Host "    Corporate IP: $CorporatePublicIP" -ForegroundColor Gray
Write-Host "    LAN Prefixes: $($CorporateLANPrefixes -join ', ')" -ForegroundColor Gray

###############################################################################
# STEP 7: Create S2S VPN Connection
###############################################################################
Write-Host ""
Write-Host "══ STEP 7/9: Create Site-to-Site VPN Connection ══" -ForegroundColor Cyan

az network vpn-connection create `
    --resource-group $HubRG `
    --name $ConnectionName `
    --location $Location `
    --vnet-gateway1 $VpnGwName `
    --local-gateway2 $LocalNetworkGwName `
    --shared-key $SharedSecret `
    --connection-protocol IKEv2 `
    --tags "project=treasury-copilot" `
    --output none

Write-Host "  ✓ S2S VPN Connection '$ConnectionName' created" -ForegroundColor Green

###############################################################################
# STEP 8: VNet Peering — Hub ↔ AKS VNet (bidirectional)
###############################################################################
Write-Host ""
Write-Host "══ STEP 8/9: VNet Peering (Hub ↔ AKS, Hub ↔ CAE) ══" -ForegroundColor Cyan

$HubVNetId = az network vnet show `
    --resource-group $HubRG `
    --name $HubVNetName `
    --query "id" --output tsv

$CaeVNetId = az network vnet show `
    --resource-group $HubRG `
    --name $CaeVNetName `
    --query "id" --output tsv

# Hub → AKS peering
az network vnet peering create `
    --resource-group $HubRG `
    --name "peer-hub-to-aks" `
    --vnet-name $HubVNetName `
    --remote-vnet $AksVNetId `
    --allow-vnet-access `
    --allow-forwarded-traffic `
    --allow-gateway-transit `
    --output none

Write-Host "  ✓ Peering: Hub → AKS" -ForegroundColor Green

# AKS → Hub peering
az network vnet peering create `
    --resource-group $AksNodeRG `
    --name "peer-aks-to-hub" `
    --vnet-name $AksVNetName `
    --remote-vnet $HubVNetId `
    --allow-vnet-access `
    --allow-forwarded-traffic `
    --use-remote-gateways `
    --output none

Write-Host "  ✓ Peering: AKS → Hub (use-remote-gateways)" -ForegroundColor Green

# Hub → CAE peering
az network vnet peering create `
    --resource-group $HubRG `
    --name "peer-hub-to-cae" `
    --vnet-name $HubVNetName `
    --remote-vnet $CaeVNetId `
    --allow-vnet-access `
    --allow-forwarded-traffic `
    --allow-gateway-transit `
    --output none

Write-Host "  ✓ Peering: Hub → CAE" -ForegroundColor Green

# CAE → Hub peering
az network vnet peering create `
    --resource-group $HubRG `
    --name "peer-cae-to-hub" `
    --vnet-name $CaeVNetName `
    --remote-vnet $HubVNetId `
    --allow-vnet-access `
    --allow-forwarded-traffic `
    --use-remote-gateways `
    --output none

Write-Host "  ✓ Peering: CAE → Hub (use-remote-gateways)" -ForegroundColor Green

###############################################################################
# STEP 9: Migrate Container Apps Environment to VNet
###############################################################################
Write-Host ""
Write-Host "══ STEP 9/9: Migrate Container Apps to VNet ══" -ForegroundColor Cyan
Write-Host "  ⚠️  The existing CAE environment is NOT VNet-integrated." -ForegroundColor Yellow
Write-Host "  ⚠️  Container Apps environments cannot be VNet-migrated after creation." -ForegroundColor Yellow
Write-Host "  ⚠️  You must create a NEW environment and migrate the app." -ForegroundColor Yellow

$CaeSubnetId = az network vnet subnet show `
    --resource-group $HubRG `
    --vnet-name $CaeVNetName `
    --name $CaeSubnetName `
    --query "id" --output tsv

# Delegate subnet to Container Apps
az network vnet subnet update `
    --resource-group $HubRG `
    --vnet-name $CaeVNetName `
    --name $CaeSubnetName `
    --delegations "Microsoft.App/environments" `
    --output none

Write-Host "  ✓ Subnet delegated to Microsoft.App/environments" -ForegroundColor Green

# Create new VNet-integrated Container Apps environment
$NewCaeEnvName = "cae-treasury-vnet"

az containerapp env create `
    --resource-group $ContainerAppsRG `
    --name $NewCaeEnvName `
    --location $Location `
    --infrastructure-subnet-resource-id $CaeSubnetId `
    --internal-only false `
    --tags "project=treasury-copilot" `
    --output none

Write-Host "  ✓ New VNet-integrated CAE environment '$NewCaeEnvName' created" -ForegroundColor Green

# Get existing app configuration
Write-Host "  Migrating treasury-aragroupcr to new environment..." -ForegroundColor Yellow

$existingApp = az containerapp show `
    --name "treasury-aragroupcr" `
    --resource-group $ContainerAppsRG `
    --query "{image:properties.template.containers[0].image, cpu:properties.template.containers[0].resources.cpu, memory:properties.template.containers[0].resources.memory, envVars:properties.template.containers[0].env}" `
    --output json | ConvertFrom-Json

# Export env vars to file for re-import
$envVarsJson = az containerapp show `
    --name "treasury-aragroupcr" `
    --resource-group $ContainerAppsRG `
    --query "properties.template.containers[0].env" `
    --output json

$envVarsJson | Out-File -FilePath ".\infra\vpn\env-vars-backup.json" -Encoding utf8

Write-Host "  ✓ Existing app config backed up to infra/vpn/env-vars-backup.json" -ForegroundColor Green

# Create the app in the new environment
az containerapp create `
    --name "treasury-aragroupcr" `
    --resource-group $ContainerAppsRG `
    --environment $NewCaeEnvName `
    --image "cr6uluhllxv7asm.azurecr.io/treasury-copilot-agent:latest" `
    --cpu 1.0 `
    --memory 2.0Gi `
    --min-replicas 1 `
    --max-replicas 3 `
    --ingress external `
    --target-port 8000 `
    --registry-server "cr6uluhllxv7asm.azurecr.io" `
    --tags "project=treasury-copilot" `
    --output none

Write-Host "  ✓ App recreated in VNet-integrated environment" -ForegroundColor Green
Write-Host "  ⚠️  You must re-apply environment variables from env-vars-backup.json" -ForegroundColor Yellow
Write-Host "  ⚠️  And update DNS/custom domain if applicable" -ForegroundColor Yellow

###############################################################################
# SUMMARY
###############################################################################
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ Azure VPN Gateway Setup Complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

$vpnGwPublicIP = az network public-ip show `
    --resource-group $HubRG `
    --name $VpnGwPublicIPName `
    --query "ipAddress" --output tsv

Write-Host "  Azure VPN Gateway Public IP: $vpnGwPublicIP" -ForegroundColor White
Write-Host ""
Write-Host "  Network Topology:" -ForegroundColor Cyan
Write-Host "    Corporate LAN (192.168.1.0/24)" -ForegroundColor White
Write-Host "        │" -ForegroundColor Gray
Write-Host "        │  IPsec IKEv2 S2S VPN" -ForegroundColor Gray
Write-Host "        │" -ForegroundColor Gray
Write-Host "    Azure VPN Gateway ($vpnGwPublicIP)" -ForegroundColor White
Write-Host "    Hub VNet (10.200.0.0/16)" -ForegroundColor White
Write-Host "        ├── Peering → AKS VNet (10.224.0.0/12)" -ForegroundColor White
Write-Host "        │       ├── Kafka brokers (kafka namespace)" -ForegroundColor Gray
Write-Host "        │       └── CDC producer/consumer (treasury-cdc namespace)" -ForegroundColor Gray
Write-Host "        └── Peering → CAE VNet (10.201.0.0/16)" -ForegroundColor White
Write-Host "                └── treasury-aragroupcr (Container App)" -ForegroundColor Gray
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  ⚠️  CORPORATE ROUTER CONFIGURATION REQUIRED" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Configure your corporate router/firewall with:" -ForegroundColor White
Write-Host ""
Write-Host "    Remote Gateway IP:  $vpnGwPublicIP" -ForegroundColor Cyan
Write-Host "    Pre-Shared Key:     $SharedSecret" -ForegroundColor Cyan
Write-Host "    IKE Version:        IKEv2" -ForegroundColor Cyan
Write-Host "    Remote Networks:    10.200.0.0/16, 10.224.0.0/12, 10.201.0.0/16" -ForegroundColor Cyan
Write-Host "    Local Networks:     192.168.1.0/24" -ForegroundColor Cyan
Write-Host ""
Write-Host "  IKEv2 Phase 1 (IKE SA):" -ForegroundColor White
Write-Host "    Encryption:   AES-256" -ForegroundColor Gray
Write-Host "    Integrity:    SHA-256" -ForegroundColor Gray
Write-Host "    DH Group:     DHGroup14 (2048-bit MODP)" -ForegroundColor Gray
Write-Host "    SA Lifetime:  28800 seconds (8 hours)" -ForegroundColor Gray
Write-Host ""
Write-Host "  IKEv2 Phase 2 (IPsec SA):" -ForegroundColor White
Write-Host "    Encryption:   AES-256" -ForegroundColor Gray
Write-Host "    Integrity:    SHA-256" -ForegroundColor Gray
Write-Host "    PFS Group:    PFS2048 (Group 14)" -ForegroundColor Gray
Write-Host "    SA Lifetime:  3600 seconds (1 hour)" -ForegroundColor Gray
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  POST-SETUP VERIFICATION COMMANDS" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""
Write-Host "  # Check VPN connection status" -ForegroundColor Gray
Write-Host "  az network vpn-connection show -g $HubRG -n $ConnectionName --query connectionStatus" -ForegroundColor White
Write-Host ""
Write-Host "  # Check VNet peering status" -ForegroundColor Gray
Write-Host "  az network vnet peering list -g $HubRG --vnet-name $HubVNetName -o table" -ForegroundColor White
Write-Host ""
Write-Host "  # Test connectivity from AKS pod to PcGraf" -ForegroundColor Gray
Write-Host "  kubectl run test-conn --rm -it --image=busybox -n treasury-cdc -- nc -zv 192.168.1.3 1433" -ForegroundColor White
Write-Host ""
Write-Host "  # Check CDC producer logs after VPN is up" -ForegroundColor Gray
Write-Host "  kubectl logs -n treasury-cdc -l app=cdc-producer --tail=20" -ForegroundColor White
Write-Host ""
Write-Host "  # Re-apply env vars to migrated Container App" -ForegroundColor Gray
Write-Host "  # (manually from infra/vpn/env-vars-backup.json)" -ForegroundColor White
Write-Host ""
