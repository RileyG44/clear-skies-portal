#!/usr/bin/env python3
"""Assemble the static web client: the GitHub Pages artifact and the site
bundled into the iOS app. Copies site.json's web files, builds app.js from its
app files exactly as site.js does, and copies the vendor directory, leaving
out the files only the Node engine uses.

    assemble-site.py <repository root> <destination directory> [--pages]

--pages adds the public landing site at the root and moves the map document to
map.html. Native bundles keep index.html as their direct map entry point. Every
build carries site.json's tree files (the landing page's maple, which the map's
start-up screen draws) at the top level, where the landing site puts them too.
"""

import json
import pathlib
import shutil
import sys


def main():
    if len(sys.argv) not in (3, 4) or (len(sys.argv) == 4 and sys.argv[3] != "--pages"):
        sys.exit("usage: assemble-site.py <repository root> <destination> [--pages]")
    root = pathlib.Path(sys.argv[1]).resolve()
    destination = pathlib.Path(sys.argv[2])
    site = json.loads((root / "site.json").read_text(encoding="utf-8"))
    engine_only = {root / name for name in site["engine"]}

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    for name in site["web"]:
        shutil.copy2(root / name, destination / name)
    for name in site["tree"]:
        shutil.copy2(root / "landing" / name, destination / name)
    # newline="": keep source bytes, including a CR if one is really there.
    # newline="\n": Windows text mode would otherwise rewrite every LF as
    # CRLF, so this file would not match the bytes site.js builds.
    # open() accepts newline on the system Python 3.9 that bundles the iOS
    # app. Path.write_text(newline=) needs Python 3.10.
    app = "".join((root / name).read_bytes().decode("utf-8") for name in site["app"])
    with (destination / "app.js").open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("(()=>{\n" + app + "})();\n")
    shutil.copytree(root / "vendor", destination / "vendor",
                    ignore=lambda folder, names: [n for n in names if pathlib.Path(folder, n) in engine_only])
    if len(sys.argv) == 4:
        (destination / "index.html").rename(destination / "map.html")
        for name in site["landing"]:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / "landing" / name, target)
        # The worker installs the same files and URLs the public site serves.
        site["web"] += ["map.html"] + [name for name in site["landing"] if name != "index.html"]
        (destination / "site.json").write_text(json.dumps(site, indent=2) + "\n", encoding="utf-8")
        manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
        manifest["start_url"] = "./map.html"
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (destination / ".nojekyll").touch()
    count = sum(1 for item in destination.rglob("*") if item.is_file())
    print(f"assemble-site: {count} files in {destination}")


if __name__ == "__main__":
    main()
