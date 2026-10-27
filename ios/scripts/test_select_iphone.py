"""Regression fixtures use the fields observed in Xcode 27 CoreDevice JSON v5."""
import copy
import subprocess
import unittest
from unittest.mock import Mock, patch

from select_iphone import is_reachable, select_iphone


def phone(identifier="phone", reality="physical", state="connected", **hardware):
    return {
        "identifier": identifier,
        "properties": {
            "hardware": {"reality": reality, "platform": "iOS", "deviceType": "iPhone",
                         **hardware},
            "connection": {"pairingState": "paired", "state": state},
        },
    }


def legacy(device):
    device = copy.deepcopy(device)
    properties = device.pop("properties")
    device["hardwareProperties"] = properties["hardware"]
    device["connectionProperties"] = properties["connection"]
    connection = device["connectionProperties"]
    connection["tunnelState"] = connection.pop("state")
    return device


class SelectionTests(unittest.TestCase):
    def test_mixed_list_only_contacts_physical_paired_iphone(self):
        devices = [phone("qa", reality="simulated"), phone("offline", state="unavailable"),
                   phone("ipad", deviceType="iPad"), phone("real"), phone("other")]
        reachable = Mock(return_value=True)
        self.assertEqual(select_iphone(devices, reachable), "real")
        reachable.assert_called_once_with("real")

    def test_current_enumeration_has_no_reachable_physical_phone(self):
        devices = [phone("qa", reality="simulated"), phone("clear-skies", reality="simulated"),
                   phone("real", state="unavailable"), phone("17-pro", reality="simulated")]
        reachable = Mock(return_value=True)
        self.assertIsNone(select_iphone(devices, reachable))
        reachable.assert_not_called()

    def test_legacy_schema_is_also_filtered(self):
        reachable = Mock(return_value=True)
        devices = [legacy(phone("sim", reality="simulated")),
                   legacy(phone("offline", state="unavailable")), legacy(phone("real"))]
        self.assertEqual(select_iphone(devices, reachable), "real")
        reachable.assert_called_once_with("real")

    def test_current_properties_override_stale_legacy_values(self):
        for current in (phone(reality="simulated"), phone(state="unavailable")):
            device = {**legacy(phone()), **current}
            reachable = Mock(return_value=True)
            self.assertIsNone(select_iphone([device], reachable))
            reachable.assert_not_called()

    def test_missing_or_unsupported_fields_fail_closed(self):
        invalid = [phone(platform="tvOS"), phone(state="unknown"), phone(identifier=""), {}]
        for category, key in (("hardware", "reality"), ("hardware", "platform"),
                              ("hardware", "deviceType"), ("connection", "pairingState"),
                              ("connection", "state")):
            device = phone()
            del device["properties"][category][key]
            invalid.append(device)
        unpaired = phone()
        unpaired["properties"]["connection"]["pairingState"] = "unpaired"
        invalid.append(unpaired)
        reachable = Mock(return_value=True)
        self.assertIsNone(select_iphone(invalid, reachable))
        reachable.assert_not_called()

    def test_idle_tunnel_is_selected_only_after_live_contact(self):
        for state in ("connected", "disconnected", "available"):
            with self.subTest(state=state):
                reachable = Mock(side_effect=[False, True])
                self.assertEqual(select_iphone([phone("stale", state=state), phone("live", state=state)],
                                               reachable), "live")
                self.assertEqual([call.args for call in reachable.call_args_list], [("stale",), ("live",)])

    def test_failed_contact_does_not_fall_back_to_simulator(self):
        reachable = Mock(return_value=False)
        self.assertIsNone(select_iphone([phone(), phone("sim", reality="simulated")], reachable))
        reachable.assert_called_once_with("phone")

    @patch("select_iphone.subprocess.run")
    def test_reachability_uses_bounded_live_device_query(self, run):
        run.return_value.returncode = 0
        self.assertTrue(is_reachable("physical-id"))
        self.assertEqual(run.call_args.args[0],
                         ["xcrun", "devicectl", "device", "info", "apps", "--device", "physical-id",
                          "--timeout", "10"])
        self.assertEqual(run.call_args.kwargs["timeout"], 15)
        run.return_value.returncode = 1
        self.assertFalse(is_reachable("physical-id"))
        for error in (OSError("missing xcrun"), subprocess.TimeoutExpired("xcrun", 15)):
            run.side_effect = error
            self.assertFalse(is_reachable("physical-id"))


if __name__ == "__main__":
    unittest.main()
