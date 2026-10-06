"""A Pi-owned renewable lease for supervised continuous motion.

This module contains no PiCar imports, so its safety rules can be tested on a
development machine. Hardware calls are made by ``picar_server`` while holding
``lock`` with the lease operation that authorizes them.
"""

from __future__ import annotations

import threading
import time
from typing import Callable


class MotionWatchdog:
    def __init__(self, deadline_seconds: float = 1.0, clock: Callable[[], float] = time.monotonic):
        if deadline_seconds <= 0:
            raise ValueError("deadline_seconds must be positive")
        self.deadline_seconds = deadline_seconds
        self._clock = clock
        self.lock = threading.RLock()
        self._driver: str | None = None
        self._motion_id: str | None = None
        self._deadline_at: float | None = None
        self._generation = 0

    def arm(self, driver: str, motion_id: str) -> int:
        with self.lock:
            self._generation += 1
            self._driver = driver
            self._motion_id = motion_id
            self._deadline_at = self._clock() + self.deadline_seconds
            return self._generation

    def renew(self, driver: str, motion_id: str) -> bool:
        with self.lock:
            if self._driver != driver or self._motion_id != motion_id or self._deadline_at is None:
                return False
            self._deadline_at = self._clock() + self.deadline_seconds
            return True

    def begin_finite_motion(self) -> int:
        """Invalidate a prior lease and return a generation for one finite move."""
        with self.lock:
            self._generation += 1
            self._driver = None
            self._motion_id = None
            self._deadline_at = None
            return self._generation

    def clear(self) -> None:
        with self.lock:
            self._generation += 1
            self._driver = None
            self._motion_id = None
            self._deadline_at = None

    def generation_is_current(self, generation: int) -> bool:
        with self.lock:
            return generation == self._generation

    def expire_if_due(self) -> str | None:
        with self.lock:
            if self._driver is None or self._deadline_at is None or self._clock() < self._deadline_at:
                return None
            expired_driver = self._driver
            self.clear()
            return expired_driver

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            now = self._clock()
            remaining = max(0.0, self._deadline_at - now) if self._deadline_at is not None else None
            return {
                "active": self._deadline_at is not None,
                "driver": self._driver,
                "deadline_seconds": self.deadline_seconds,
                "remaining_seconds": remaining,
            }
