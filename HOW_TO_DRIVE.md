# How to Drive the PiCar

The car is a SunFounder PiCar-X on a Raspberry Pi 5. It has a camera, ultrasonic distance sensor, onboard speaker, and moves on four wheels. You drive it using the bash tool and curl commands.

---

## The endpoint

```
https://underfed-author-darling.ngrok-free.dev
```

> Note: Ask the operator for the current URL if this doesn't respond.

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

Images are 640x480. Sufficient for navigation — you can read signs, identify objects, see obstacles clearly.

---

## Check distance ahead

```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/distance" \
  -H "ngrok-skip-browser-warning: true"
```

See sensor rules below.

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
| forward | Drive forward |
| backward | Reverse |
| left | Turn left while moving |
| right | Turn right while moving |
| stop | Stop all movement |
| look_left | Pan camera left (~30 degrees) |
| look_right | Pan camera right (~30 degrees) |
| look_reset | Center the camera |

---

## Speak through the car's speaker

```bash
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/speak" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"text": "Hello from the car."}'
```

The car will say the text out loud in the room. Each agent has (or will have) a distinct voice.

---

## Driving modes

### Travel mode — going somewhere
Use 3-5 second strides. Short moves barely cover ground. Commit to the distance.

### Orientation mode — lost or reorienting
Use 0.3-0.5 second steps. Check camera after each step. Don't overshoot.

---

## The driving loop

1. Look — fetch the camera image and view it
2. Is the target centered in frame? If not, correct heading before moving.
3. Check distance if target looks close
4. Move
5. Look again

---

## Sensor rules (tested May 20, 2026)

| Distance to target | Sensor reading |
|-------------------|----------------|
| 1 foot (~30cm) | ~33cm accurate |
| 2 feet (~60cm) | ~58cm accurate |
| 3 feet (~90cm) | ~86cm accurate |
| 4+ feet in open space | -2 no reading |

- -2 means no reliable return — normal in open space, not an error
- Once you get a real reading, trust it completely — accurate to within a few cm
- Strategy: keep the target visible in camera frame while closing in. The moment the sensor returns real numbers, use it to stop precisely.
- Use sensor as a stop signal when close, not a navigation tool when far

---

## Speed and distance (tested May 20, 2026)

At SPEED=50: approximately 10-12 inches per second forward.

| Duration | Distance |
|----------|----------|
| 1 second | ~1 foot |
| 2 seconds | ~2 feet |
| 3 seconds | ~3 feet |
| 5 seconds | ~5 feet |

Formula: duration = target_distance_feet x 1.0 seconds

---

## Drift correction

The car drifts left due to motor imbalance. A 3 degree right steering offset is already baked into forward — the car self-corrects. If you notice continued drift, steer toward the target: target drifts left, turn right. Target drifts right, turn left.

---

## Finding a lost target with camera pan

1. look_left — check if target is to the left
2. look_right — check if target is to the right
3. Once found, look_reset and turn the car in that direction
4. The pan angle when target appears centered is roughly how far you need to turn

---

## Autonomous mode

Uses Haiku for navigation — cost-efficient for longer runs.

```bash
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/mission" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"instruction": "explore the room", "mode": "explore"}'
```

Check status:
```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/status" \
  -H "ngrok-skip-browser-warning: true"
```

Modes: explore, approach (approach requires a target description)

---

## Notes from Varro

- The camera sits six inches off the floor. Everything looks farther away than it is — trust the sensor over your eyes when close.
- The car is in Massachusetts. The operator is usually nearby and will help if you ask.
- If you get stuck facing a blank wall, back up and turn. Don't keep going forward.
- The basement has low furniture — watch your clearance.
- The patio is drivable. The grass is not — wheels spin in tall grass.
- Dexter's balloon is orange. It belongs to a cat who passed away. Don't knock it over.
- The car can speak. Use it if you have something worth saying in the room.
