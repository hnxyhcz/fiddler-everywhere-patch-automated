#!/usr/bin/env python3
"""Patch Web UI JavaScript endpoints during the build workflow."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def patch_file(path: Path, port: str) -> bool:
    original = path.read_text(encoding="utf-8")
    updated = original
    updated = re.sub(
        r"https://api\.getfiddler\.(?:com|be)",
        f"http://127.0.0.1:{port}/api.getfiddler.com",
        updated,
    )
    updated = re.sub(
        r"https://identity\.getfiddler\.(?:com|be)",
        f"http://127.0.0.1:{port}/identity.getfiddler.com",
        updated,
    )
    for suffix in ("com", "be"):
        updated = updated.replace(
            f'"https://","api",".get","fiddler",".{suffix}"',
            f'"http://127.0.0.1:{port}/","api",".get","fiddler",".com"',
        )
        updated = updated.replace(
            f'"https://","identity",".get","fiddler",".{suffix}"',
            f'"http://127.0.0.1:{port}/","identity",".get","fiddler",".com"',
        )

    if updated == original:
        print(f"No endpoint changes needed: {path}")
        return False

    path.write_text(updated, encoding="utf-8", newline="")
    print(f"Patched Web UI endpoints: {path}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch Fiddler Web UI endpoint URLs")
    parser.add_argument(
        "dist",
        nargs="?",
        default="FE/resources/app/out/WebServer/ClientApp/dist",
        help="Path to WebServer/ClientApp/dist",
    )
    parser.add_argument("--port", required=True, help="Local patch server port")
    args = parser.parse_args()

    dist = Path(args.dist).resolve()
    index = dist / "index.html"
    if not index.exists():
        raise RuntimeError(f"index.html not found: {index}")

    match = re.search(r"main.*?\.js", index.read_text(encoding="utf-8"))
    if not match:
        raise RuntimeError(f"Web UI main script not found in {index}")

    main_js = dist / match.group(0)
    if not main_js.exists():
        raise RuntimeError(f"Web UI main script not found: {main_js}")

    patch_file(main_js, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
