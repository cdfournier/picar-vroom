import unittest

from wheels_gate import handoff_authorization, motion_authorization


class MotionAuthorizationTests(unittest.TestCase):
    def test_requires_an_attributed_driver(self):
        self.assertEqual(
            motion_authorization("Julian", ""),
            (False, "driver is required before the car can move"),
        )

    def test_rejects_an_unassigned_wheel(self):
        self.assertEqual(
            motion_authorization(None, "Julian"),
            (False, "the wheel is unassigned; take the wheel before driving"),
        )

    def test_rejects_a_second_driver(self):
        self.assertEqual(
            motion_authorization("Varro", "Julian"),
            (False, "the wheel is held by Varro"),
        )

    def test_allows_the_active_driver(self):
        self.assertEqual(motion_authorization("Julian", "Julian"), (True, "authorized"))


class HandoffAuthorizationTests(unittest.TestCase):
    def test_take_does_not_replace_an_active_driver(self):
        allowed, message = handoff_authorization("Varro", "Julian", "take")
        self.assertFalse(allowed)
        self.assertIn("wheel is held by Varro", message)

    def test_explicit_override_can_take_the_wheel(self):
        self.assertEqual(handoff_authorization("Varro", "Julian", "take", force=True), (True, "authorized"))

    def test_only_the_active_driver_can_release_normally(self):
        allowed, message = handoff_authorization("Varro", "Julian", "release")
        self.assertFalse(allowed)
        self.assertIn("only Varro", message)


if __name__ == "__main__":
    unittest.main()
