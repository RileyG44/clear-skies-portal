#!/usr/bin/env python3
"""Assemble the static web client: the GitHub Pages artifact and the site
bundled into the iOS app. Copies site.json's web files, builds app.js from its
app files exactly as site.js does, and copies the vendor directory, leaving
out the files only the Node engine uses.

    assemble-site.py <repository root> <destination directory>
"""

import json
import pathlib
import shutil
import sys


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: assemble-site.py <repository root> <destination>")
    root = pathlib.Path(sys.argv[1]).resolve()
    destination = pathlib.Path(sys.argv[2])
    site = json.loads((root / "site.json").read_text(encoding="utf-8"))
    engine_only = {root / name for name in site["engine"]}

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in site["web"]:
        shutil.copy2(root / name, destination / name)
    # newline="": keep source bytes, including a CR if one is really there.
    # newline="\n": Windows text mode would otherwise rewrite every LF as
    # CRLF, so this file would not match the bytes site.js builds.
    app = "".join((root / name).read_text(encoding="utf-8", newline="") for name in site["app"])
    (destination / "app.js").write_text("(()=>{\n" + app + "})();\n", encoding="utf-8", newline="\n")
    shutil.copytree(root / "vendor", destination / "vendor",
                    ignore=lambda folder, names: [n for n in names if pathlib.Path(folder, n) in engine_only])
    (destination / ".nojekyll").touch()
    count = sum(1 for item in destination.rglob("*") if item.is_file())
    print(f"assemble-site: {count} files in {destination}")


if __name__ == "__main__":
    main()
