# ══════════════════════════════════════════════════════════════════════════════
# Treasury Copilot — Azure Container App Deployment Script
# ══════════════════════════════════════════════════════════════════════════════
# Usage:
#   .\deploy-azure.ps1
#
# Prerequisites:
#   - Azure CLI installed (az --version)
#   - Docker Desktop running
#   - Logged into Azure (az login)
# ══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
# Fix Azure CLI Unicode output on Windows (e.g. Vite's checkmark character)
$env:PYTHONIOENCODING = "utf-8"

# ── Configuration ─────────────────────────────────────────────────────────────
$SubscriptionId                = "fc30746c-e06a-42e3-98ab-f7d74ab3b360"
$ResourceGroupName             = "rg-cocinas-prod"
$Location                      = "East US 2"

# ACR
$AcrName                       = "cr6uluhllxv7asm"
$ImageName                     = "treasury-cxc-cxp"
$ImageTag                      = (Get-Date -Format "yyyyMMdd-HHmmss")

# Container App
$ContainerAppName              = "treasury-aragroupcr"
$ContainerAppsEnvironmentName  = "cae-6uluhllxv7asm"
$ContainerPort                 = 8000

# Vite build-time env vars (baked into static JS)
$VITE_SUPABASE_URL             = "https://aanhzgezgyawitpvwrcw.supabase.co"
$VITE_SUPABASE_ANON_KEY        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbmh6Z2V6Z3lhd2l0cHZ3cmN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MzU4MDksImV4cCI6MjA4NjAxMTgwOX0.5OLuTL1u9KW6kslGOLoKGNhDyEs09-F9ojzGTLyKjPU"
$VITE_COPILOT_CLOUD_API_KEY    = "ck_pub_4991084f42b4ffd8427ce109c8e7ece4"

# Derived
$AcrLoginServer = "$AcrName.azurecr.io"
$FullImageName  = "$AcrLoginServer/${ImageName}:${ImageTag}"
$LatestImage    = "$AcrLoginServer/${ImageName}:latest"

# ── Step 0: Set subscription ─────────────────────────────────────────────────
Write-Host "`n=== Setting Azure subscription ===" -ForegroundColor Cyan
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { throw "Failed to set subscription. Run 'az login' first." }

# ── Step 1: Build & push image with ACR Build (no local Docker needed) ────────
Write-Host "`n=== Building image in ACR: $FullImageName ===" -ForegroundColor Cyan
Write-Host "  (cloud build - Docker Desktop not required)" -ForegroundColor DarkGray
$imgTagged = "${ImageName}:${ImageTag}"
$imgLatest = "${ImageName}:latest"
Write-Host "  Starting ACR build (no-logs to avoid encoding issues)..." -ForegroundColor DarkGray
az acr build --registry $AcrName --image $imgTagged --image $imgLatest --build-arg "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" --build-arg "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" --build-arg "VITE_COPILOT_CLOUD_API_KEY=$VITE_COPILOT_CLOUD_API_KEY" --platform linux/amd64 --no-logs .
if ($LASTEXITCODE -ne 0) { throw "ACR Build failed." }
# Wait for build completion by checking repository
Write-Host "  Waiting for build to finish..." -ForegroundColor DarkGray
$maxWait = 300  # 5 minutes
$waited = 0
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 15
    $waited += 15
    $tags = az acr repository show-tags --name $AcrName --repository $ImageName --output tsv 2>$null
    if ($tags -match $ImageTag) {
        Write-Host "  Build complete! Image $imgTagged available." -ForegroundColor Green
        break
    }
    Write-Host "  Waiting... ($waited s)" -ForegroundColor DarkGray
}
if ($waited -ge $maxWait) { throw "ACR Build timed out after $maxWait seconds." }

# ── Step 4: Get ACR credentials ──────────────────────────────────────────────
Write-Host "`n=== Getting ACR credentials ===" -ForegroundColor Cyan
$credQuery = "{username:username, password:passwords[0].value}"
$AcrCreds = az acr credential show --name $AcrName --query $credQuery -o json | ConvertFrom-Json
$AcrUsername = $AcrCreds.username
$AcrPassword = $AcrCreds.password

# ── Step 5: Create or update Container App ────────────────────────────────────
Write-Host "`n=== Deploying Container App: $ContainerAppName ===" -ForegroundColor Cyan

# Check if the container app already exists
$existingApp = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName 2>$null
if ($LASTEXITCODE -eq 0 -and $existingApp) {
    Write-Host "  Container App exists - updating image..." -ForegroundColor Yellow
    az containerapp update --name $ContainerAppName --resource-group $ResourceGroupName --image $FullImageName --set-env-vars "PORT=8000"
    if ($LASTEXITCODE -ne 0) { throw "Container App update failed." }
} else {
    Write-Host "  Creating new Container App..." -ForegroundColor Green
    az containerapp create --name $ContainerAppName --resource-group $ResourceGroupName --environment $ContainerAppsEnvironmentName --image $FullImageName --registry-server $AcrLoginServer --registry-username $AcrUsername --registry-password $AcrPassword --target-port $ContainerPort --ingress external --min-replicas 0 --max-replicas 3 --cpu 0.25 --memory 0.5Gi --env-vars "PORT=8000" --query "properties.configuration.ingress.fqdn" --output tsv
    if ($LASTEXITCODE -ne 0) { throw "Container App creation failed." }
}

# ── Step 6: Get the app URL ──────────────────────────────────────────────────
Write-Host "`n=== Fetching deployed URL ===" -ForegroundColor Cyan
$AppFQDN = az containerapp show --name $ContainerAppName --resource-group $ResourceGroupName --query "properties.configuration.ingress.fqdn" --output tsv

Write-Host "`n══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "  Image:  $FullImageName" -ForegroundColor White
Write-Host "  App:    https://$AppFQDN" -ForegroundColor Yellow
Write-Host "══════════════════════════════════════════════════════════════`n" -ForegroundColor Green
