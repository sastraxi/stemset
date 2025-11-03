#!/usr/bin/env python3
"""Check deployment configuration and readiness.

Usage:
    python scripts/check_deployment.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv()


def check_env_var(name: str, required: bool = True) -> bool:
    """Check if environment variable is set."""
    value = os.getenv(name)
    if value:
        print(f"  ✅ {name}: {'*' * 8} (set)")
        return True
    elif required:
        print(f"  ❌ {name}: NOT SET (required)")
        return False
    else:
        print(f"  ⚠️  {name}: not set (optional)")
        return True


def check_file(path: Path, description: str) -> bool:
    """Check if file exists."""
    if path.exists():
        print(f"  ✅ {description}: {path}")
        return True
    else:
        print(f"  ❌ {description}: {path} NOT FOUND")
        return False


def main() -> None:
    """Main entry point."""
    print("🔍 Checking Stemset deployment configuration...\n")

    all_good = True

    # Check dependencies
    print("📦 Dependencies:")
    try:
        import boto3

        print("  ✅ boto3 installed")
    except ImportError:
        print("  ❌ boto3 NOT installed - run: uv sync")
        all_good = False

    try:
        import litestar

        print("  ✅ litestar installed")
    except ImportError:
        print("  ❌ litestar NOT installed - run: uv sync")
        all_good = False

    # Check configuration files
    print("\n📄 Configuration Files:")
    all_good &= check_file(Path("config.yaml"), "config.yaml")
    all_good &= check_file(Path(".env.example"), ".env.example")
    all_good &= check_file(Path("pyproject.toml"), "pyproject.toml")
    all_good &= check_file(Path(".koyeb/config.yaml"), "Koyeb config")
    all_good &= check_file(Path("frontend/wrangler.toml"), "Cloudflare Pages config")

    # Check environment variables
    print("\n🔐 Environment Variables (Backend):")
    all_good &= check_env_var("GOOGLE_CLIENT_ID", required=False)
    all_good &= check_env_var("GOOGLE_CLIENT_SECRET", required=False)
    all_good &= check_env_var("JWT_SECRET", required=False)
    all_good &= check_env_var("OAUTH_REDIRECT_URI")
    all_good &= check_env_var("FRONTEND_URL")

    print("\n☁️  R2 Configuration:")
    r2_configured = True
    r2_configured &= check_env_var("R2_ACCOUNT_ID", required=False)
    r2_configured &= check_env_var("R2_ACCESS_KEY_ID", required=False)
    r2_configured &= check_env_var("R2_SECRET_ACCESS_KEY", required=False)
    r2_configured &= check_env_var("R2_BUCKET_NAME", required=False)

    if not r2_configured:
        print("\n  ℹ️  R2 not configured - will use local storage")
        print("     To enable R2, set the variables above and uncomment r2 section in config.yaml")

    # Check media directory
    print("\n📁 Media Directory:")
    media_path = Path("media")
    if media_path.exists():
        profiles = [
            d.name for d in media_path.iterdir() if d.is_dir() and not d.name.startswith(".")
        ]
        if profiles:
            print(f"  ✅ Media directory exists with profiles: {', '.join(profiles)}")
            print("     Files ready to upload to R2")
        else:
            print("  ⚠️  Media directory exists but is empty")
            print("     Run 'uv run stemset process <profile>' to generate stems")
    else:
        print("  ⚠️  Media directory not found")
        print("     Will be created when you process audio")

    # Check frontend
    print("\n🎨 Frontend:")
    frontend_dist = Path("frontend/dist")
    if frontend_dist.exists():
        print("  ✅ Frontend built (dist/ exists)")
    else:
        print("  ⚠️  Frontend not built")
        print("     Run: cd frontend && bun run build")

    # Summary
    print("\n" + "=" * 60)
    if all_good:
        print("✅ All critical checks passed!")
        print("\n📝 Next steps:")
        if not r2_configured:
            print("   1. Setup Cloudflare R2 (see DEPLOYMENT.md Part 1)")
            print("   2. Set R2 environment variables in .env")
            print("   3. Uncomment r2 section in config.yaml")
        else:
            print("   1. Deploy backend to Koyeb (see DEPLOYMENT.md Part 2)")
            print("   2. Deploy frontend to Cloudflare Pages (see DEPLOYMENT.md Part 3)")
            print("   3. Upload audio files to R2: python scripts/upload_to_r2.py")
    else:
        print("❌ Some checks failed. Please review the output above.")
        print("\n📚 See DEPLOYMENT.md for setup instructions")
        sys.exit(1)


if __name__ == "__main__":
    main()
