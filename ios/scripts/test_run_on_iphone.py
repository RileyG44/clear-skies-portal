"""Exercise the real zsh runner with mocked Xcode tools, never real installs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest

from test_select_iphone import phone


SCRIPT = Path(__file__).with_name("run-on-iphone.sh").resolve()


@unittest.skipUnless(shutil.which("zsh"), "runner requires zsh")
class RunnerTests(unittest.TestCase):
    def run_script(self, devices, *arguments, install_exit=0, launch_exit=0):
        with tempfile.TemporaryDirectory(prefix="csp-iphone-runner-") as temporary:
            directory = Path(temporary)
            fixture = directory / "devices.json"
            fixture.write_text(json.dumps({"result": {"devices": devices}}))
            log = directory / "calls.jsonl"
            mock = textwrap.dedent('''\
                #!/usr/bin/env python3
                import json, os, pathlib, sys
                tool = pathlib.Path(sys.argv[0]).name
                args = sys.argv[1:]
                with open(os.environ["CSP_TEST_LOG"], "a") as output:
                    output.write(json.dumps([tool, *args]) + "\\n")
                if tool == "xcrun":
                    if args[:3] == ["devicectl", "list", "devices"]:
                        target = pathlib.Path(args[args.index("--json-output") + 1])
                        target.write_text(pathlib.Path(os.environ["CSP_TEST_FIXTURE"]).read_text())
                    elif args[:4] == ["devicectl", "device", "install", "app"]:
                        sys.exit(int(os.environ["CSP_TEST_INSTALL_EXIT"]))
                    elif args[:4] == ["devicectl", "device", "process", "launch"]:
                        sys.exit(int(os.environ["CSP_TEST_LAUNCH_EXIT"]))
                    elif args[:4] != ["devicectl", "device", "info", "apps"]:
                        sys.exit(99)
                ''')
            for name in ("xcrun", "xcodegen", "xcodebuild"):
                path = directory / name
                path.write_text(mock)
                path.chmod(0o755)
            env = {**os.environ, "PATH": str(directory) + os.pathsep + os.environ["PATH"],
                   "CSP_TEST_FIXTURE": str(fixture), "CSP_TEST_LOG": str(log),
                   "CSP_TEST_INSTALL_EXIT": str(install_exit), "CSP_TEST_LAUNCH_EXIT": str(launch_exit)}
            # zsh allows a function for an absolute command path. Source the
            # unchanged runner so no real plist, build output or device is touched.
            wrapper = ('function /usr/libexec/PlistBuddy() { print dev.riley.ClearSkies; }; '
                       'runner_script=$1; shift; source "$runner_script" "$@"')
            result = subprocess.run(["zsh", "-c", wrapper, "test-runner", str(SCRIPT), *arguments],
                                    env=env, capture_output=True, text=True, timeout=30)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            for call in calls:
                if "--json-output" in call:
                    self.assertFalse(Path(call[call.index("--json-output") + 1]).exists(),
                                     "device-list temporary file was not cleaned up")
            return result, calls

    def test_mixed_list_and_launch_activation_options(self):
        devices = [phone("qa", reality="simulated"), phone("offline", state="unavailable"), phone("real")]
        for arguments in ((), ("--no-activate",)):
            with self.subTest(arguments=arguments):
                result, calls = self.run_script(devices, *arguments)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual([call[:5] for call in calls if call[0] == "xcrun"],
                                 [["xcrun", "devicectl", "list", "devices", "--json-output"],
                                  ["xcrun", "devicectl", "device", "info", "apps"],
                                  ["xcrun", "devicectl", "device", "install", "app"],
                                  ["xcrun", "devicectl", "device", "process", "launch"]])
                for call in calls:
                    if "--device" in call:
                        self.assertEqual(call[call.index("--device") + 1], "real")
                self.assertEqual([call[0] for call in calls],
                                 ["xcrun", "xcrun", "xcodegen", "xcodebuild", "xcrun", "xcrun"])
                launch = calls[-1]
                self.assertIn("--terminate-existing", launch)
                self.assertEqual("--no-activate" in launch, bool(arguments))
                self.assertIn("Installed Clear Skies on physical iPhone real.", result.stdout)

    def test_no_physical_phone_exits_before_build_or_install(self):
        result, calls = self.run_script([phone("sim", reality="simulated"), phone(state="unavailable")],
                                        "--no-activate")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(calls), 1)
        self.assertIn("No reachable, paired physical iPhone", result.stderr)
        self.assertNotIn("Installed", result.stdout)

    def test_install_failure_does_not_launch_or_claim_installation(self):
        result, calls = self.run_script([phone()], install_exit=3)
        self.assertEqual(result.returncode, 3)
        self.assertEqual(calls[-1][1:5], ["devicectl", "device", "install", "app"])
        self.assertNotIn("Installed", result.stdout + result.stderr)

    def test_launch_failure_reports_installation_and_fails(self):
        result, _ = self.run_script([phone()], launch_exit=4)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Installed on the physical iPhone, but launch failed", result.stderr)

    def test_extra_arguments_are_rejected_without_running_tools(self):
        result, calls = self.run_script([phone()], "--no-activate", "unexpected")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
