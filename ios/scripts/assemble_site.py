#!/usr/bin/env python3
"""Copy the hosted web client into the app bundle.

The GitHub Pages artifact is the web client that runs away from the Mac and
reaches the engine at a configured address. That is exactly what the app
hosts, so the file list is read from the "Assemble the static site" step in
.github/workflows/ci.yml instead of being kept a second time here. If that
step changes shape, this fails the build rather than shipping a partial site.

    assemble_site.py <repository root> <destination directory>
"""

import pathlib
import re
import shutil
import sys

STEP = re.compile(r"- name: Assemble the static site\n\s+run: \|\n((?:[ \t]+\S.*\n)+)")
SAFE = re.compile(r"^[A-Za-z0-9._/-]+$")
STAGE = "_site"


def fail(message):
    sys.exit(f"assemble_site: {message}")


def commands(workflow):
    match = STEP.search(workflow)
    if not match:
        fail("could not find the 'Assemble the static site' step in ci.yml")
    return [line.split() for line in match.group(1).splitlines() if line.strip()]


def staged(path, destination):
    """Map a path under _site to the same path under the destination."""
    if path.rstrip("/") == STAGE:
        return destination
    if not path.startswith(STAGE + "/"):
        fail(f"copy target {path!r} is outside {STAGE}/")
    return destination / path[len(STAGE) + 1:].rstrip("/")


def main():
    if len(sys.argv) != 3:
        fail("usage: assemble_site.py <repository root> <destination>")
    root = pathlib.Path(sys.argv[1]).resolve()
    destination = pathlib.Path(sys.argv[2])
    workflow = (root / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)

    copied = 0
    for words in commands(workflow):
        if words == ["mkdir", STAGE]:
            continue
        if not words or words[0] != "cp":
            fail(f"unexpected command in the Pages step: {' '.join(words)}")
        recursive = len(words) > 1 and words[1] == "-R"
        operands = words[2:] if recursive else words[1:]
        if len(operands) < 2 or not all(SAFE.match(word) for word in operands):
            fail(f"unexpected copy in the Pages step: {' '.join(words)}")
        *sources, target = operands
        target_path = staged(target, destination)
        for source in sources:
            source_path = (root / source).resolve()
            if root not in source_path.parents:
                fail(f"{source} is outside the repository")
            if recursive and source_path.is_dir():
                # cp -R dir new-path copies the directory to that new path.
                into = target_path if not target_path.exists() else target_path / source_path.name
                shutil.copytree(source_path, into)
                copied += sum(1 for item in into.rglob("*") if item.is_file())
            elif source_path.is_file():
                into = target_path / source_path.name if target.endswith("/") or target_path.is_dir() else target_path
                into.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, into)
                copied += 1
            else:
                fail(f"{source} does not exist")

    if not (destination / "index.html").is_file():
        fail("the assembled site has no index.html")
    print(f"assemble_site: copied {copied} files into {destination}")


if __name__ == "__main__":
    main()
