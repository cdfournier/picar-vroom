"""Pure readiness rules for the supervised WHEELS operator surface."""


CAMERA_FRESH_SECONDS = 15


def camera_snapshot(camera_health, now):
    """Turn the latest camera attempt into an honest, displayable state."""
    last_success = camera_health.get("last_success_at")
    last_error = camera_health.get("last_error")
    last_error_at = camera_health.get("last_error_at")

    if last_success is not None and (last_error_at is None or last_success >= last_error_at):
        age_seconds = max(0, round(now - last_success, 1))
        state = "live" if age_seconds <= CAMERA_FRESH_SECONDS else "stale"
        return {
            "state": state,
            "age_seconds": age_seconds,
            "last_success_at": last_success,
            "last_error": None,
        }

    if last_error:
        return {
            "state": "error",
            "age_seconds": None,
            "last_success_at": last_success,
            "last_error": last_error,
        }

    return {
        "state": "unknown",
        "age_seconds": None,
        "last_success_at": None,
        "last_error": None,
    }


def distance_snapshot(distance, error=None):
    """Represent the ultrasonic result without mistaking open space for failure."""
    if error:
        return {"state": "error", "cm": None, "error": error}
    if distance is None:
        return {"state": "unknown", "cm": None, "error": None}
    if distance < 0:
        return {"state": "open", "cm": distance, "error": None}
    return {"state": "reported", "cm": distance, "error": None}


def readiness_snapshot(driver, camera, distance):
    """Build a small preflight snapshot without claiming invisible facts."""
    wheel_held = bool(driver)
    camera_ready = camera["state"] == "live"
    distance_ready = distance["state"] in {"open", "reported"}
    missing = []
    if not wheel_held:
        missing.append("assign a driver")
    if not camera_ready:
        missing.append("refresh the camera")
    if not distance_ready:
        missing.append("check the distance sensor")

    return {
        "wheel": {
            "driver": driver,
            "state": "held" if wheel_held else "unassigned",
            "motion_gate": "active",
        },
        "camera": camera,
        "distance": distance,
        "preflight_ready": not missing,
        "needs": missing,
        "supervision": "manual confirmation required",
        "network": "unverified",
    }
