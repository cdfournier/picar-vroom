import unittest

from motion_watchdog import MotionWatchdog


class FakeClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


class MotionWatchdogTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.watchdog = MotionWatchdog(1.0, clock=self.clock)

    def test_deadline_expires_for_the_active_driver(self):
        self.watchdog.arm("Chris", "motion-a")
        self.clock.now += 0.99
        self.assertIsNone(self.watchdog.expire_if_due())

        self.clock.now += 0.01
        self.assertEqual(self.watchdog.expire_if_due(), "Chris")
        self.assertFalse(self.watchdog.snapshot()["active"])

    def test_only_matching_driver_and_motion_id_can_renew(self):
        self.watchdog.arm("Chris", "motion-a")
        self.clock.now += 0.75
        self.assertFalse(self.watchdog.renew("Varro", "motion-a"))
        self.assertFalse(self.watchdog.renew("Chris", "motion-b"))
        self.assertTrue(self.watchdog.renew("Chris", "motion-a"))

        self.clock.now += 0.75
        self.assertIsNone(self.watchdog.expire_if_due())
        self.clock.now += 0.25
        self.assertEqual(self.watchdog.expire_if_due(), "Chris")

    def test_clear_rejects_late_renewals(self):
        self.watchdog.arm("Chris", "motion-a")
        self.watchdog.clear()

        self.assertFalse(self.watchdog.renew("Chris", "motion-a"))
        self.clock.now += 10
        self.assertIsNone(self.watchdog.expire_if_due())

    def test_old_finite_completion_cannot_stop_newer_motion(self):
        finite_generation = self.watchdog.begin_finite_motion()
        self.watchdog.arm("Chris", "motion-a")

        self.assertFalse(self.watchdog.generation_is_current(finite_generation))

    def test_rejects_non_positive_deadlines(self):
        with self.assertRaises(ValueError):
            MotionWatchdog(0)


if __name__ == "__main__":
    unittest.main()
