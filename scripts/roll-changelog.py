#!/usr/bin/env python3
"""Roll CHANGELOG.md [Unreleased] into a version and print its release notes."""

import argparse
import datetime
import pathlib
import re
import sys


parser = argparse.ArgumentParser()
parser.add_argument("version")
parser.add_argument("--date", default=datetime.date.today().isoformat())
parser.add_argument("--file", default="CHANGELOG.md")
args = parser.parse_args()

if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
    sys.exit("Version must use X.Y.Z format.")

path = pathlib.Path(args.file)
text = path.read_text(encoding="utf-8")
heading = f"## [{args.version}]"

if heading not in text:
    unreleased = re.search(r"## \[Unreleased\]\s*\n(.*?)(?=\n## \[|\Z)", text, re.S)
    if not unreleased:
        sys.exit("CHANGELOG.md is missing '## [Unreleased]'.")
    notes = unreleased.group(1).strip()
    if not notes:
        sys.exit("CHANGELOG.md [Unreleased] has no release notes.")

    text = text.replace(
        "## [Unreleased]",
        f"## [Unreleased]\n\n{heading} - {args.date}",
        1,
    )
    text = re.sub(
        r"^\[Unreleased\]:\s+https://github\.com/OreoSolutions/oreodeck/compare/v[^.\s]+(?:\.[^.\s]+){2}\.\.\.HEAD$",
        f"[Unreleased]: https://github.com/OreoSolutions/oreodeck/compare/v{args.version}...HEAD",
        text,
        flags=re.M,
    )
    release_link = f"[{args.version}]: https://github.com/OreoSolutions/oreodeck/releases/tag/v{args.version}"
    if not re.search(rf"^\[{re.escape(args.version)}\]:", text, re.M):
        text = text.rstrip() + "\n" + release_link + "\n"
    path.write_text(text, encoding="utf-8")

match = re.search(
    rf"## \[{re.escape(args.version)}\].*?\n(.*?)(?=\n## \[|\n\[[^\]]+\]:|\Z)",
    text,
    re.S,
)
notes = match.group(1).strip() if match else ""
if not notes:
    sys.exit(f"CHANGELOG.md has no notes for {args.version}.")
print(notes)
