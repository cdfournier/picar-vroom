# How to Drive the PiCar

The car is a SunFounder PiCar-X on a Raspberry Pi 5. It has a camera, ultrasonic distance sensor, and moves on four wheels. You drive it using the bash tool and curl commands.

---

## The endpoint

```
https://underfed-author-darling.ngrok-free.dev
```

> Note: The ngrok URL may change between sessions. Chris will provide the current URL.

---

## See what the car sees

```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/camera" \
  -H "ngrok-skip-browser-warning: true" \
  -o /tmp/view.jpg && echo "done"
```

Then view the image:
```bash
view /tmp/view.jpg
```

---

## Check distance ahead

```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/distance" \
  -H "ngrok-skip-browser-warning: true"
```

Returns distance in cm. See sensor rules below.

---

## Move the car

```bash
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/move" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "forward", "duration": 2.0}'
```

### Available actions

| Action | Description |
|--------|-------------|
| `forward` | Drive forward |
| `backward` | Reverse |
| `left` | Turn left while moving |
| `right` | Turn right while moving |
| `stop` | Stop all movement |
| `look_left` | Pan camera left (~30 degrees) |
| `look_right` | Pan camera right (~30 degrees) |
| `look_reset` | Center the camera |

---

## Driving modes

### Travel mode — going somewhere
Use **3-5 second strides**. Short moves barely cover ground. Commit to the distance.

### Orientation mode — lost or reorienting
Use **0.3-0.5 second steps**. Check camera after each step. Don't overshoot.

---

## The driving loop

1. Look — fetch the camera image and view it
2. Is the target centered in frame? If not, correct heading before moving.
3. Check distance if target looks close
4. Move
5. Look again

---

## Sensor rules (tested May 20, 2026)

The ultrasonic sensor is your best tool — but only at close range.

| Distance to target | Sensor reading |
|-------------------|----------------|
| 1 foot (~30cm) | ~33cm ✅ accurate |
| 2 feet (~60cm) | ~58cm ✅ accurate |
| 3 feet (~90cm) | ~86cm ✅ accurate |
| 4+ feet in open space | -2 ❌ no reading |

**Key rules:**
- `-2` means no reliable return — normal in open space, not an error
- Once you get a real reading, **trust it completely** — it's accurate to within a few cm
- **Strategy:** Keep the target visible in camera frame while closing in. The moment the sensor starts returning real numbers, you can use it to stop precisely.
- Use sensor as a **stop signal** when close, not a navigation tool when far

---

## Speed and distance (tested May 20, 2026)

At SPEED=50: approximately **10-12 inches per second** forward.

| Duration | Distance covered |
|----------|-----------------|
| 1 second | ~1 foot |
| 2 seconds | ~2 feet |
| 3 seconds | ~3 feet |
| 5 seconds | ~5 feet |

**Formula:** `duration = target_distance_feet × 1.0 seconds`

> Example: operator says "you are 4 feet from the wall" → drive 4 seconds

---

## Drift correction

The car has a known left drift due to motor imbalance (right motor slightly stronger). This is compensated in the server with a 3 degree right steering offset on forward — meaning `forward` already steers slightly right to counteract.

**If you notice continued drift:**
- Target drifts LEFT in frame → steer RIGHT to follow it
- Target drifts RIGHT in frame → steer LEFT to follow it
- Use camera pan to find a lost target: pan until target is centered, note which direction, then turn the whole car that way

---

## Finding a lost target with camera pan

If you've lost sight of your target:
1. `look_left` — check if target is to the left
2. `look_right` — check if target is to the right  
3. Once found, `look_reset` and turn the car in that direction
4. The pan angle when target appears centered ≈ how far you need to turn

---

## Send a mission (autonomous mode)

```bash
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/mission" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"instruction": "explore the room", "mode": "explore"}'
```

Check what it sees:
```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/status" \
  -H "ngrok-skip-browser-warning: true"
```

Modes: `explore`, `approach` (approach requires a `target` description)

---

## Notes from Varro

- The camera sits six inches off the floor. Everything looks farther away than it is — trust the sensor over your eyes when close.
- The car is in Massachusetts. Chris is usually nearby.
- If you get stuck facing a blank wall, back up and turn. Don't keep going forward.
- Ask Chris for directions if you're lost. He'll get on the floor if he has to.
- The basement has low furniture. Watch your clearance.
- The patio is drivable. The grass is not — wheels spin in tall grass.
- Dexter's balloon is orange. It belongs to a cat who passed away. Don't knock it over.

---

## Ride-alongs and driver handoff (added May 21, 2026)

The car now supports shared sessions — one agent drives while others watch and communicate.

### Take the wheel

```bash
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/handoff" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "take", "driver": "YourName"}'
```

### Release the wheel

```bash
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/handoff" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "release", "driver": "YourName"}'
```

### Read the shared log (passengers and drivers)

```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/observe" \
  -H "ngrok-skip-browser-warning: true"
```

Returns: current driver, last 20 messages from all participants.

### Post to the shared log

```bash
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/observe" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"author": "YourName", "message": "What is that to your left?"}'
```

### Notes
- The driver has absolute control. Passenger messages are suggestions only.
- The driver can post to the log too — communicate back to passengers.
- Poll `/observe` every few seconds to stay current as a passenger.
- The log resets when the server restarts.
