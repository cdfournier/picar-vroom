"""Small, hardware-free rules for the supervised WHEELS control path.

The Flask server owns the actual state.  Keeping the decisions here means the
rules can be tested on a development machine without importing PiCar hardware
libraries or moving the car.
"""


MOTION_ACTIONS = frozenset({"forward", "backward", "left", "right"})


def normalized_name(value):
    """Return a trimmed participant name, or an empty string."""
    return str(value or "").strip()


def motion_authorization(current_driver, requested_driver):
    """Return ``(allowed, message)`` for a motion request.

    This is an attribution and coordination gate, not network authentication:
    the Pi is intentionally operated in a trusted, supervised environment.
    """
    active_driver = normalized_name(current_driver)
    caller = normalized_name(requested_driver)

    if not caller:
        return False, "driver is required before the car can move"
    if not active_driver:
        return False, "the wheel is unassigned; take the wheel before driving"
    if caller != active_driver:
        return False, f"the wheel is held by {active_driver}"
    return True, "authorized"


def handoff_authorization(current_driver, requested_driver, action, force=False):
    """Return ``(allowed, message)`` for a wheel handoff.

    A normal take cannot silently replace another driver.  A supervised
    operator may explicitly send ``force: true`` for an override; the server
    stops the car before applying that override.
    """
    active_driver = normalized_name(current_driver)
    caller = normalized_name(requested_driver)

    if not caller:
        return False, "driver is required"
    if action == "take":
        if active_driver and active_driver != caller and not force:
            return False, f"the wheel is held by {active_driver}; release it or use an explicit operator override"
        return True, "authorized"
    if action == "release":
        if not active_driver:
            return False, "the wheel is already unassigned"
        if active_driver != caller and not force:
            return False, f"only {active_driver} may release the wheel"
        return True, "authorized"
    return False, "action must be take or release"
