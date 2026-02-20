"""Setup script to create Modal secrets and deploy the treasury agent.

Run this once to configure Modal secrets, then deploy with:
    modal deploy agent/modal_app.py
"""

import os
import subprocess
import sys


def _get_secret_value(key: str) -> str:
    value = os.environ.get(key, "").strip()
    if value:
        return value
    return input(f"Enter value for {key}: ").strip()


def main():
    print("=== Treasury Copilot — Modal Setup ===\n")

    # Step 1: Check modal CLI
    try:
        result = subprocess.run(["modal", "--version"], capture_output=True, text=True)
        print(f"Modal CLI: {result.stdout.strip()}")
    except FileNotFoundError:
        print("ERROR: Modal CLI not found. Install with: pip install modal")
        sys.exit(1)

    # Step 2: Create secrets
    print("\nCreating Modal secret 'treasury-copilot-secrets'...")
    print("(This will prompt for values if they don't exist)\n")

    secrets = {
        "OPENROUTER_API_KEY": _get_secret_value("OPENROUTER_API_KEY"),
        "SUPABASE_URL": _get_secret_value("SUPABASE_URL"),
        "SUPABASE_SERVICE_ROLE_KEY": _get_secret_value("SUPABASE_SERVICE_ROLE_KEY"),
        "LANGCHAIN_API_KEY": _get_secret_value("LANGCHAIN_API_KEY"),
        "TAVILY_API_KEY": _get_secret_value("TAVILY_API_KEY"),
    }

    cmd = ["modal", "secret", "create", "treasury-copilot-secrets"]
    for key, value in secrets.items():
        cmd.append(f"{key}={value}")

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print("Secret created successfully!")
    else:
        if "already exists" in result.stderr:
            print("Secret already exists. Updating...")
            # Try update
            cmd[2] = "update"  # modal secret update
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                print("Secret updated successfully!")
            else:
                print(f"Note: {result.stderr.strip()}")
                print("You may need to delete and recreate: modal secret delete treasury-copilot-secrets")
        else:
            print(f"Error: {result.stderr.strip()}")

    # Step 3: Create volume
    print("\nCreating Modal volume 'treasury-faiss-index'...")
    result = subprocess.run(
        ["modal", "volume", "create", "treasury-faiss-index"],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print("Volume created!")
    else:
        if "already exists" in result.stderr:
            print("Volume already exists.")
        else:
            print(f"Note: {result.stderr.strip()}")

    print("\n=== Setup Complete ===")
    print("\nNext steps:")
    print("  1. Deploy to Modal:  modal deploy agent/modal_app.py")
    print("  2. Get the URL from Modal dashboard")
    print("  3. Update VITE_AGENT_URL in .env with the Modal URL")
    print("  4. Run frontend:    npm run dev")


if __name__ == "__main__":
    main()
