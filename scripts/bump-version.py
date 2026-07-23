#!/usr/bin/env python3
"""Update every OreoDeck source-of-truth version to the requested SemVer."""

import argparse
import pathlib
import re
import sys


parser = argparse.ArgumentParser()
parser.add_argument("version")
parser.add_argument("--root", default=".")
args = parser.parse_args()

if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
    sys.exit("Version must use X.Y.Z format.")

root = pathlib.Path(args.root)
json_files = [
    "package.json",
    "packages/cli/package.json",
    "packages/core/package.json",
    "packages/contract-fixtures/package.json",
]
for relative in json_files:
    path = root / relative
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'(?m)^(\s*"version"\s*:\s*)"[^"]+"',
        rf'\g<1>"{args.version}"',
        text,
        count=1,
    )
    if count != 1:
        sys.exit(f"Could not update version in {relative}.")
    path.write_text(updated, encoding="utf-8")

replacements = {
    "packages/core-rs/Cargo.toml": (
        r'(?m)^(version\s*=\s*)"[^"]+"',
        rf'\g<1>"{args.version}"',
    ),
    "packages/cli/src/version.ts": (
        r'(?m)^(export const OREODECK_VERSION\s*=\s*)"[^"]+"',
        rf'\g<1>"{args.version}"',
    ),
    "packages/app/Sources/CcmUI/AppModel.swift": (
        r'(CFBundleShortVersionString"\) as\? String \?\? )"[^"]+"',
        rf'\g<1>"{args.version}"',
    ),
}
for relative, (pattern, replacement) in replacements.items():
    path = root / relative
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        sys.exit(f"Could not update version in {relative}.")
    path.write_text(updated, encoding="utf-8")
