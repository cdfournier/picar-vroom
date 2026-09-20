import unittest

from wheels_readiness import camera_snapshot, distance_snapshot, readiness_snapshot


class CameraSnapshotTests(unittest.TestCase):
    def test_camera_is_live_after_a_recent_success(self):
        snapshot = camera_snapshot({"last_success_at": 100, "last_error": None, "last_error_at": None}, 110)
        self.assertEqual(snapshot["state"], "live")
        self.assertEqual(snapshot["age_seconds"], 10)

    def test_camera_becomes_stale_without_a_fresh_read(self):
        snapshot = camera_snapshot({"last_success_at": 100, "last_error": None, "last_error_at": None}, 116)
        self.assertEqual(snapshot["state"], "stale")

    def test_recent_error_is_not_hidden_by_an_old_success(self):
        snapshot = camera_snapshot(
            {"last_success_at": 100, "last_error": "camera busy", "last_error_at": 105},
            106,
        )
        self.assertEqual(snapshot["state"], "error")


class ReadinessSnapshotTests(unittest.TestCase):
    def test_open_space_is_a_valid_distance_read(self):
        distance = distance_snapshot(-2)
        snapshot = readiness_snapshot("Chris", {"state": "live"}, distance)
        self.assertTrue(snapshot["preflight_ready"])
        self.assertEqual(snapshot["distance"]["state"], "open")

    def test_unassigned_wheel_is_a_clear_preflight_requirement(self):
        snapshot = readiness_snapshot(None, {"state": "live"}, distance_snapshot(60))
        self.assertFalse(snapshot["preflight_ready"])
        self.assertIn("assign a driver", snapshot["needs"])

    def test_camera_error_blocks_preflight(self):
        snapshot = readiness_snapshot("Chris", {"state": "error"}, distance_snapshot(60))
        self.assertFalse(snapshot["preflight_ready"])
        self.assertIn("refresh the camera", snapshot["needs"])
