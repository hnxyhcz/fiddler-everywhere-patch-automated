#!/usr/bin/env python3
"""
Generic Fiddler Everywhere IntegrityCheckService patcher.

It parses .NET metadata to locate:
  Fiddler.WebUi.Services.IntegrityCheckService.ExecuteAsync(...)
and rewrites the method body to:
  call System.Threading.Tasks.Task::get_CompletedTask
  ret

No fixed RVA/file offset is used. The only semantic assumptions are the type,
method and return helper names.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

try:
    import dnfile
except Exception as exc:  # pragma: no cover
    raise SystemExit("Missing dependency: dnfile. Install with: python -m pip install dnfile") from exc

TARGET_NS = "Fiddler.WebUi.Services"
TARGET_TYPE = "IntegrityCheckService"
TARGET_METHOD = "ExecuteAsync"
SCRIPT_NS = "Fiddler.WebUi.Helpers"
SCRIPT_TYPE = "ScriptHelper"
SCRIPT_METHODS = ("TryOpenClientMainScript", "TryOpenElectronMainScript")
TASK_TYPE = "System.Threading.Tasks.Task"
TASK_COMPLETED = "get_CompletedTask"


@dataclass(frozen=True)
class MethodBodyInfo:
    body_offset: int
    code_offset: int
    code_size: int
    header_size: int
    header_kind: str


@dataclass(frozen=True)
class PatchTarget:
    type_name: str
    method_name: str
    method_token: int
    method_rva: int
    body: MethodBodyInfo
    completed_task_token: int


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def type_full_name(row_or_index) -> str:
    row = getattr(row_or_index, "row", row_or_index)
    if row is None:
        return ""
    if hasattr(row, "TypeNamespace") and hasattr(row, "TypeName"):
        ns = str(row.TypeNamespace)
        name = str(row.TypeName)
        return f"{ns}.{name}" if ns else name
    if hasattr(row, "Namespace") and hasattr(row, "Name"):
        ns = str(row.Namespace)
        name = str(row.Name)
        return f"{ns}.{name}" if ns else name
    if hasattr(row, "Name"):
        return str(row.Name)
    return str(row)


def method_names(type_def) -> list[str]:
    names: list[str] = []
    for mref in getattr(type_def, "MethodList", []):
        try:
            names.append(str(mref.row.Name))
        except Exception:
            pass
    return names


def find_completed_task_token(dn) -> int:
    rows = getattr(dn.net.mdtables, "MemberRef").rows
    exact: list[tuple[int, str]] = []
    loose: list[tuple[int, str]] = []

    for index, row in enumerate(rows, 1):
        name = str(row.Name)
        if name != TASK_COMPLETED:
            continue
        owner = type_full_name(row.Class)
        token = 0x0A000000 | index
        if owner == TASK_TYPE:
            exact.append((token, owner))
        elif owner.endswith(".Task") or owner == "Task":
            loose.append((token, owner))

    if exact:
        return exact[0][0]
    if loose:
        return loose[0][0]
    raise RuntimeError(f"Could not find MemberRef {TASK_TYPE}::{TASK_COMPLETED}")


def iter_type_defs(dn) -> Iterable:
    return getattr(dn.net.mdtables, "TypeDef").rows


def find_integrity_type(dn):
    exact = []
    fallback = []
    for td in iter_type_defs(dn):
        full = type_full_name(td)
        names = method_names(td)
        if TARGET_METHOD not in names:
            continue
        if full == f"{TARGET_NS}.{TARGET_TYPE}":
            exact.append(td)
            continue
        # Fallback for minor namespace/name shifts in nearby versions.
        if TARGET_TYPE in full or "Integrity" in full:
            fallback.append(td)
            continue
        # Fallback for services that still inherit BackgroundService.
        try:
            parent = type_full_name(td.Extends)
        except Exception:
            parent = ""
        if parent.endswith("BackgroundService") and "Check" in full:
            fallback.append(td)

    if exact:
        return exact[0]
    if len(fallback) == 1:
        return fallback[0]
    if fallback:
        joined = "\n  ".join(type_full_name(x) for x in fallback)
        raise RuntimeError("Multiple possible integrity services found; specify --type-full-name:\n  " + joined)
    raise RuntimeError(f"Could not find {TARGET_NS}.{TARGET_TYPE}.{TARGET_METHOD}")


def find_method(type_def, name: str):
    for mref in type_def.MethodList:
        if str(mref.row.Name) == name:
            return mref.row_index, mref.row
    raise RuntimeError(f"Type {type_full_name(type_def)} does not contain method {name}")


def parse_method_body(data: bytes | bytearray, body_offset: int) -> MethodBodyInfo:
    first = data[body_offset]
    fmt = first & 0x03
    if fmt == 0x02:  # tiny header
        code_size = first >> 2
        return MethodBodyInfo(
            body_offset=body_offset,
            code_offset=body_offset + 1,
            code_size=code_size,
            header_size=1,
            header_kind="tiny",
        )
    if fmt == 0x03:  # fat header
        flags_and_size = int.from_bytes(data[body_offset : body_offset + 2], "little")
        header_size = ((flags_and_size >> 12) & 0x0F) * 4
        code_size = int.from_bytes(data[body_offset + 4 : body_offset + 8], "little")
        return MethodBodyInfo(
            body_offset=body_offset,
            code_offset=body_offset + header_size,
            code_size=code_size,
            header_size=header_size,
            header_kind="fat",
        )
    raise RuntimeError(f"Unsupported method body header at 0x{body_offset:X}: 0x{first:02X}")


def locate_target(path: Path, type_full_name_override: Optional[str] = None) -> tuple[object, PatchTarget]:
    dn = dnfile.dnPE(str(path))
    if not dn.net:
        raise RuntimeError(f"Not a .NET assembly: {path}")

    if type_full_name_override:
        matches = [td for td in iter_type_defs(dn) if type_full_name(td) == type_full_name_override]
        if not matches:
            raise RuntimeError(f"Specified type not found: {type_full_name_override}")
        type_def = matches[0]
    else:
        type_def = find_integrity_type(dn)

    method_index, method = find_method(type_def, TARGET_METHOD)
    completed_token = find_completed_task_token(dn)
    body_offset = dn.get_offset_from_rva(method.Rva)
    body = parse_method_body(path.read_bytes(), body_offset)

    target = PatchTarget(
        type_name=type_full_name(type_def),
        method_name=str(method.Name),
        method_token=0x06000000 | method_index,
        method_rva=int(method.Rva),
        body=body,
        completed_task_token=completed_token,
    )
    return dn, target


def expected_il(completed_task_token: int) -> bytes:
    # 0x28 = call, operand = metadata token, 0x2A = ret
    return bytes([0x28]) + completed_task_token.to_bytes(4, "little") + bytes([0x2A])


def expected_tiny_body(completed_task_token: int) -> bytes:
    il = expected_il(completed_task_token)
    if len(il) >= 64:
        raise ValueError("Tiny method body supports code size below 64 bytes")
    # Tiny method header: low bits 0b10, upper six bits = code size.
    return bytes([(len(il) << 2) | 0x02]) + il


def is_patched(data: bytes | bytearray, target: PatchTarget) -> bool:
    body = target.body
    if body.header_kind != "tiny":
        return False
    return data[body.code_offset : body.code_offset + 6] == expected_il(target.completed_task_token)


def is_legacy_fat_code_patch(data: bytes | bytearray, target: PatchTarget) -> bool:
    """Detect the first implementation that only replaced IL inside the old fat body.

    That variant can still leave an unsuitable method body header/local signature in
    place and has been observed to raise InvalidProgramException on FE 8.0.1.
    """

    body = target.body
    return body.header_kind != "tiny" and data[body.code_offset : body.code_offset + 6] == expected_il(
        target.completed_task_token
    )


def patch_file(path: Path, *, dry_run: bool, type_full_name_override: Optional[str], backup_suffix: str) -> int:
    path = path.resolve()
    data = bytearray(path.read_bytes())
    before_hash = sha256(path)
    dn, target = locate_target(path, type_full_name_override)
    try:
        print(f"Target file:        {path}")
        print(f"Assembly SHA256:    {before_hash}")
        print(f"Target type:        {target.type_name}")
        print(f"Target method:      {target.method_name}")
        print(f"MethodDef token:    0x{target.method_token:08X}")
        print(f"Method RVA:         0x{target.method_rva:X}")
        print(f"Method body offset: 0x{target.body.body_offset:X}")
        print(f"Code offset:        0x{target.body.code_offset:X}")
        print(f"Code size:          {target.body.code_size}")
        print(f"Header kind:        {target.body.header_kind}")
        print(f"CompletedTask ref:  0x{target.completed_task_token:08X}")

        new_body = expected_tiny_body(target.completed_task_token)
        old_body_span = target.body.header_size + target.body.code_size
        if old_body_span < len(new_body):
            raise RuntimeError(f"Method body too small: {old_body_span} bytes")

        if is_patched(data, target):
            print("Status:             already patched")
            return 0

        if is_legacy_fat_code_patch(data, target):
            print("Status:             legacy fat-header patch found; converting to tiny-body patch")

        if dry_run:
            print("Status:             dry-run only; no file was changed")
            return 0

        backup = path.with_name(path.name + backup_suffix)
        if not backup.exists():
            shutil.copy2(path, backup)
            print(f"Backup:             {backup}")
        else:
            print(f"Backup:             {backup} (already exists)")

        # Replace the entire method body header with a tiny method body:
        #   tiny-header(size=6), call Task.CompletedTask, ret
        #
        # This deliberately does not preserve the old fat header/local signature.
        # Keeping the old fat header while replacing only the IL can trigger
        # InvalidProgramException in FE 8.x during JIT compilation.
        start = target.body.body_offset
        end = start + old_body_span
        data[start:end] = new_body + bytes([0x00]) * (old_body_span - len(new_body))
    finally:
        try:
            dn.close()
        except Exception:
            pass

    path.write_bytes(data)
    after_hash = sha256(path)
    print("Status:             patched")
    print(f"New SHA256:         {after_hash}")
    return 0


def restore_file(path: Path, backup_suffix: str) -> int:
    path = path.resolve()
    backup = path.with_name(path.name + backup_suffix)
    if not backup.exists():
        raise RuntimeError(f"Backup not found: {backup}")
    shutil.copy2(backup, path)
    print(f"Restored: {path}")
    print(f"SHA256:   {sha256(path)}")
    return 0


def find_type(dn, full_name: str):
    matches = [td for td in iter_type_defs(dn) if type_full_name(td) == full_name]
    if not matches:
        raise RuntimeError(f"Specified type not found: {full_name}")
    return matches[0]


def patch_startup_checks(
    path: Path,
    *,
    dry_run: bool,
    backup_suffix: str,
) -> int:
    """Make ScriptHelper's startup file checks return success.

    FE 8.1.0 calls both methods from Program.Main before and after starting
    Kestrel. The methods have the signature:

        bool Method(out string error)

    Returning true while writing null to the out parameter avoids exit code
    252 when the Electron package has been unpacked and app.asar is absent.
    The target is located from .NET metadata, not a fixed RVA.
    """

    path = path.resolve()
    data = bytearray(path.read_bytes())
    dn = dnfile.dnPE(str(path))
    try:
        try:
            script_type = find_type(dn, f"{SCRIPT_NS}.{SCRIPT_TYPE}")
        except RuntimeError:
            # FE 8.0.x does not have the 8.1.0 startup guards. Integrity
            # patching has already completed, so this is not an error.
            print("Startup checks:    ScriptHelper target not present; skipped")
            return 0

        targets = []
        for method_name in SCRIPT_METHODS:
            try:
                method_index, method = find_method(script_type, method_name)
            except RuntimeError:
                print(f"Startup target:     {method_name} not present; skipped")
                continue
            body_offset = dn.get_offset_from_rva(method.Rva)
            body = parse_method_body(data, body_offset)
            targets.append((method_name, method_index, method, body))

        if not targets:
            print("Startup checks:    no startup targets present; skipped")
            return 0

        # ldarg.0; ldnull; stind.ref; ldc.i4.1; ret
        il = bytes([0x02, 0x14, 0x51, 0x17, 0x2A])
        new_body = bytes([(len(il) << 2) | 0x02]) + il
        patches = []
        for method_name, method_index, method, body in targets:
            old_body_span = body.header_size + body.code_size
            if old_body_span < len(new_body):
                raise RuntimeError(f"Method body too small for {method_name}: {old_body_span} bytes")

            print(f"Startup target:     {method_name}")
            print(f"MethodDef token:    0x{(0x06000000 | method_index):08X}")
            print(f"Method RVA:         0x{int(method.Rva):X}")
            print(f"Method body offset: 0x{body.body_offset:X}")
            print(f"Header kind:        {body.header_kind}")
            print(f"Code size:          {body.code_size}")

            start = body.body_offset
            if data[start : start + len(new_body)] == new_body:
                print("Status:             already patched")
                continue
            patches.append((start, old_body_span))

        if not patches:
            return 0
        if dry_run:
            print(f"Status:             dry-run only; {len(patches)} method(s) would change")
            return 0

        backup = path.with_name(path.name + backup_suffix)
        if not backup.exists():
            shutil.copy2(path, backup)
            print(f"Backup:             {backup}")
        else:
            print(f"Backup:             {backup} (already exists)")

        for start, old_body_span in patches:
            data[start : start + old_body_span] = new_body + bytes(old_body_span - len(new_body))
    finally:
        try:
            dn.close()
        except Exception:
            pass

    # Close dnfile before replacing the DLL. On Windows, writing while the PE
    # mapping is still alive can fail even when the path itself is valid.
    path.write_bytes(data)
    print(f"Status:             patched ({len(patches)} startup method(s))")
    print(f"New SHA256:         {sha256(path)}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generic Fiddler.WebUi.dll integrity-check patcher")
    parser.add_argument(
        "dll",
        nargs="?",
        default=str(Path("FiddlerEverywhere") / "resources" / "app" / "out" / "WebServer" / "Fiddler.WebUi.dll"),
        help="Path to Fiddler.WebUi.dll",
    )
    parser.add_argument("--dry-run", action="store_true", help="Locate target and print plan without writing")
    parser.add_argument("--restore", action="store_true", help="Restore from backup")
    parser.add_argument("--backup-suffix", default=".bak-integrity", help="Backup suffix")
    parser.add_argument("--type-full-name", help="Override target type full name if autodetection is ambiguous")
    parser.add_argument(
        "--skip-startup-checks",
        action="store_true",
        help="Only patch IntegrityCheckService; do not patch ScriptHelper startup checks",
    )
    args = parser.parse_args(argv)

    path = Path(args.dll)
    if args.restore:
        return restore_file(path, args.backup_suffix)
    result = patch_file(
        path,
        dry_run=args.dry_run,
        type_full_name_override=args.type_full_name,
        backup_suffix=args.backup_suffix,
    )
    if result != 0 or args.skip_startup_checks:
        return result
    return patch_startup_checks(
        path,
        dry_run=args.dry_run,
        backup_suffix=".bak-startup-check",
    )


if __name__ == "__main__":
    raise SystemExit(main())
