#!/usr/bin/env python3
"""Check the installed Debug app's real WebKit bridge without screen capture."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("device", help="A paired iPhone identifier from xcrun devicectl list devices")
    parser.add_argument("--output", type=Path, help="Save the JSON verification result")
    parser.add_argument("--probe", type=Path, default=Path(__file__).with_name("verify_shell.js"),
                        help="Async JavaScript verification body (default: verify_shell.js)")
    parser.add_argument("--timeout", type=float, default=90, help="Seconds to wait for this run's result")
    parser.add_argument("--page", help="Open a native tool sheet using the existing Debug page hook")
    parser.add_argument("--panel", help="Open a native popover using the existing Debug panel hook")
    args = parser.parse_args()
    env = dict(os.environ)
    env.setdefault("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer")
    run_id = str(uuid.uuid4())
    probe = args.probe.read_text()

    def device_command(*arguments):
        return subprocess.run(["xcrun", "devicectl", "device", *arguments], env=env,
                              capture_output=True, text=True, timeout=30)

    launch_arguments = ["-cspDebugScript", probe, "-cspDebugRunID", run_id]
    if args.page:
        launch_arguments += ["-cspDebugPage", args.page]
    if args.panel:
        launch_arguments += ["-cspDebugPanel", args.panel]
    launch = device_command("process", "launch", "--device", args.device, "--no-activate",
                            "--terminate-existing", "dev.riley.ClearSkies", "--",
                            *launch_arguments)
    if launch.returncode:
        raise RuntimeError(launch.stdout + launch.stderr)

    with tempfile.TemporaryDirectory(prefix="clearskies-shell-") as temporary:
        local = Path(temporary) / "result.json"
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            copy = device_command("copy", "from", "--device", args.device,
                                  "--domain-type", "appDataContainer", "--domain-identifier", "dev.riley.ClearSkies",
                                  "--source", "Library/Caches/csp-debug-result.json", "--destination", str(local),
                                  "--timeout", "5")
            if copy.returncode == 0 and local.exists():
                payload = json.loads(local.read_text())
                # Never accept the previous run's cached result.
                if payload.get("runID") == run_id:
                    if args.output:
                        args.output.write_text(json.dumps(payload, indent=2) + "\n")
                    if not payload.get("ok"):
                        raise RuntimeError(payload.get("error", "Debug script failed"))
                    result = payload["result"]
                    if not result.get("passed"):
                        raise RuntimeError("\n".join(result.get("failures", [])))
                    if "pages" in result:
                        print(f"Native shell checks passed: {len(result['pages'])} routes, {len(result['panels'])} popovers")
                    else:
                        print("Device checks passed: " + args.probe.name)
                    return
            time.sleep(0.5)
    raise RuntimeError("No result from this run. Install the current Debug build and unlock the iPhone if needed.")


if __name__ == "__main__":
    main()
