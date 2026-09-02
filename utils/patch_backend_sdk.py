#!/usr/bin/env python3
"""
Patch FiddlerBackendSDK.dll during the build workflow.

Keeping this work out of server/index.js avoids synchronous DLL reads/scans on
every application startup.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
from pathlib import Path


DOMAIN_PATCHES = [
    (
        "api.getfiddler.be",
        bytes.fromhex("6100700069002e0067006500740066006900640064006c00650072002e0062006500"),
        bytes.fromhex("3100320037002e0030002e0030002e00310000000000000000000000000000000000"),
    ),
    (
        "api host length",
        bytes.fromhex("FF11001F118D3700000125"),
        bytes.fromhex("FF11001F098D3700000125"),
    ),
    (
        "identity.getfiddler.be",
        bytes.fromhex(
            "6900640065006e0074006900740079002e0067006500740066006900640064006c00650072002e0062006500"
        ),
        bytes.fromhex(
            "3100320037002e0030002e0030002e0031000000000000000000000000000000000000000000000000000000"
        ),
    ),
    (
        "identity host length",
        bytes.fromhex("0011001F168D3700000125"),
        bytes.fromhex("0011001F098D3700000125"),
    ),
]

HOST_WHITELIST_PATCHES = [
    (
        "NotifySetConfiguration host whitelist",
        bytes.fromhex("7e1200000411006f2d00000a392e000000"),
        bytes.fromhex("3821000000000000000000000000000000"),
    ),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def find_signature_branch(data: bytearray, first_byte: int) -> list[int]:
    positions: list[int] = []
    for i in range(0, len(data) - 13):
        if data[i] != first_byte or data[i + 1] != 0x2A or data[i + 2] != 0x28:
            continue
        first_call = int.from_bytes(data[i + 3 : i + 7], "little")
        second_call = int.from_bytes(data[i + 8 : i + 12], "little")
        if (
            first_call >> 24 == 0x0A
            and data[i + 7] == 0x28
            and second_call >> 24 == 0x0A
            and data[i + 12] == 0x13
        ):
            positions.append(i)
    return positions


def replace_once_or_skip(data: bytearray, name: str, old: bytes, new: bytes) -> bool:
    pos = data.find(old)
    if pos >= 0:
        data[pos : pos + len(new)] = new
        print(f"Patched {name} at 0x{pos:X}")
        return True

    if data.find(new) >= 0:
        print(f"Already patched: {name}")
        return False

    print(f"Pattern not found: {name}")
    return False


def patch_file(path: Path, backup_suffix: str, dry_run: bool) -> int:
    path = path.resolve()
    data = bytearray(path.read_bytes())
    print(f"Target file:     {path}")
    print(f"SHA256 before:   {sha256(path)}")

    changed = False

    patched_signature = find_signature_branch(data, 0x17)
    original_signature = find_signature_branch(data, 0x16)
    if patched_signature:
        print(
            "Already patched: signature whitelist branch at "
            + ", ".join(f"0x{x:X}" for x in patched_signature)
        )
    elif len(original_signature) == 1:
        data[original_signature[0]] = 0x17
        changed = True
        print(f"Patched signature whitelist branch at 0x{original_signature[0]:X}")
    elif len(original_signature) == 0:
        print("Pattern not found: signature whitelist branch")
    else:
        print(
            f"Found {len(original_signature)} possible signature whitelist branches; skipped"
        )

    for name, old, new in DOMAIN_PATCHES:
        changed = replace_once_or_skip(data, name, old, new) or changed

    for name, old, new in HOST_WHITELIST_PATCHES:
        changed = replace_once_or_skip(data, name, old, new) or changed

    if not changed:
        print("Status:          no changes needed")
        return 0
    if dry_run:
        print("Status:          dry-run only")
        return 0

    backup = path.with_name(path.name + backup_suffix)
    if not backup.exists():
        shutil.copy2(path, backup)
        print(f"Backup:          {backup}")
    else:
        print(f"Backup:          {backup} (already exists)")

    path.write_bytes(data)
    print("Status:          patched")
    print(f"SHA256 after:    {sha256(path)}")
    return 0


def restore_file(path: Path, backup_suffix: str) -> int:
    path = path.resolve()
    backup = path.with_name(path.name + backup_suffix)
    if not backup.exists():
        raise RuntimeError(f"Backup not found: {backup}")
    shutil.copy2(backup, path)
    print(f"Restored:        {path}")
    print(f"SHA256:          {sha256(path)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch FiddlerBackendSDK.dll")
    parser.add_argument("dll", help="Path to FiddlerBackendSDK.dll")
    parser.add_argument("--backup-suffix", default=".bak-signing")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()

    path = Path(args.dll)
    if args.restore:
        return restore_file(path, args.backup_suffix)
    return patch_file(path, args.backup_suffix, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
