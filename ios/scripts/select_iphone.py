#!/usr/bin/env python3
"""Select a reachable, paired physical iPhone from CoreDevice JSON."""
import json
import subprocess
import sys


def is_reachable(identifier):
    # A disconnected tunnel can be opened on demand. Query the actual device
    # rather than treating a cached connection/transport as proof of reachability.
    try:
        result = subprocess.run(
            ["xcrun", "devicectl", "device", "info", "apps", "--device", identifier,
             "--timeout", "10"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def select_iphone(devices, reachable=is_reachable):
    for device in devices:
        # Xcode 27 JSON v5 replaces these legacy dictionaries with properties.
        # Fall back only when a category is absent, never over current values.
        properties = device.get("properties", {})
        hardware = properties.get("hardware", device.get("hardwareProperties", {}))
        connection = properties.get("connection", device.get("connectionProperties", {}))
        state = connection.get("state", connection.get("tunnelState"))
        identifier = device.get("identifier")
        if (hardware.get("reality") == "physical"
                and hardware.get("platform") == "iOS"
                and hardware.get("deviceType") == "iPhone"
                and connection.get("pairingState") == "paired"
                and state in ("connected", "disconnected", "available")
                and isinstance(identifier, str) and identifier.strip()
                and reachable(identifier)):
            return identifier
    return None


def main():
    try:
        with open(sys.argv[1]) as source:
            devices = json.load(source)["result"]["devices"]
        device = select_iphone(devices)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"Could not read the CoreDevice device list: {error}", file=sys.stderr)
        return 1
    if device is None:
        print("No reachable, paired physical iPhone was found. Connect and unlock the iPhone "
              "by cable or on the same network, then run this again. No app was installed.",
              file=sys.stderr)
        return 1
    print(device)
    return 0


if __name__ == "__main__":
    sys.exit(main())
