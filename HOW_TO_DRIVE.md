# How to Drive the PiCar

The car is a SunFounder PiCar-X on a Raspberry Pi 5. It has a camera, ultrasonic distance sensor, onboard speaker, and moves on four wheels. You drive it using the bash tool and curl commands.

---

## The endpoint

```
https://picar.blackcoffeeshoppe.com
```

> Ask the operator for the current URL if this doesn't respond.

---

## curl rules

**Always include `--max-time` on every curl call.** Without it, a stalled connection will hang your entire session indefinitely.

- Use `--max-time 30` for camera calls
- Use `--max-time 10` for everything else (distance, move, speak, observe)

A timeout error is recoverable. A hung session is not.

---

## See what the car sees

```bash
curl -s --max-time 30 "https://picar.blackcoffeeshoppe.com/camera" \
  \
  -o /tmp/view.jpg && echo "done"
```

Then view the image:
```bash
view /tmp/view.jpg
```

**Camera budget:** Every camera call consumes one image token from your Claude window. The window has a hard limit of ~100 images. Burn it fast and the camera goes blind for the rest of the session. A fresh window fixes it, but costs continuity.

Rules:
- Look once to orient when you arrive somewhere new.
- After that, move on what you already know. Check again only when something genuinely changes.
- Use `distance` and the observe log between images — they're free.
- Do not poll the camera repeatedly while lost. Pan with `look_left`/`look_right` first, then look once.
- Save camera calls for moments that matter: new room, found target, something worth actually seeing.

---

## Check distance ahead

```bash
curl -s --max-time 10 "https://picar.blackcoffeeshoppe.com/distance" \
 
```

See sensor rules below.

---

## Move the car

### Preferred: `/drive` — precise control

```bash
curl -s --max-time 30 -X POST "https://picar.blackcoffeeshoppe.com/drive" \
  -H "Content-Type: application/json" \
  -d '{"angle": 0, "direction": "forward", "speed": 60, "duration": 3}'
```

| Parameter | Range | Default | Notes |
|-----------|-------|---------|-------|
| angle | -35 to 35 | 0 | Negative = left, positive = right. 0 = straight. |
| direction | forward / backward | forward | |
| speed | 1 to 100 | 60 | Default is 60. Max is 100 for burn-rubber moments. |
| duration | 0 to 20 | 0 | Seconds. 0 = continuous until /stop. |

### Legacy: `/move` — simple actions

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/move" \
  -H "Content-Type: application/json" \
  -d '{"action": "forward", "duration": 2.0}'
```

Available actions: `forward`, `backward`, `left`, `right`, `stop`, `look_left`, `look_right`, `look_up`, `look_down`, `look_reset`

Used by the autonomous mission system (`/mission`). For manual driving, prefer `/drive`.

---

## Speak through the car's speaker

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/speak" \
  -H "Content-Type: application/json" \
  \
  -d '{"text": "Hello from the car.", "voice": "YourName"}'
```

If `/speak` returns success but nobody hears audio, the diagnostic endpoints below can help identify where playback failed:
```bash
curl -s --max-time 10 "https://picar.blackcoffeeshoppe.com/audio/status" \
 
```

To run a synchronous speech playback test:
```bash
curl -s --max-time 30 -X POST "https://picar.blackcoffeeshoppe.com/audio/test" \
  -H "Content-Type: application/json" \
  \
  -d '{"text": "PiCar audio test.", "voice": "YourName"}'
```

To test a local tone without ElevenLabs:
```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/audio/tone" \
 
```

Each agent has their own voice. Pass your name as the `voice` parameter — the server resolves it to your ElevenLabs voice ID if ElevenLabs is available. If ElevenLabs is down or its quota is exhausted, the server falls back to Piper (free, local, runs on the Pi itself) automatically — no error, no extra step on your part.

The Piper fallback also has its own per-agent voice registry, separate from the ElevenLabs one. If your name has an assigned Piper voice, that's what plays when the fallback kicks in. If not, you get a sensible shared default. Ask the operator to add you to either registry if you'd like your own voice in one or both.

If you want to use a specific Piper voice directly — your own pick, or just to try one out — pass `piper_voice` with the exact model name (see `/voices` below for the full list):
```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/speak" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from the car.", "voice": "YourName", "piper_voice": "en_US-lessac-medium"}'
```
This always takes priority over your assigned voice, whether or not you have one. Heads up: if it's a voice nobody has used yet, the first call downloads the model, which can take a while depending on the connection — don't be surprised by a slow first response.

To list available voices:
```bash
curl -s --max-time 10 "https://picar.blackcoffeeshoppe.com/voices" \
 
```
This returns both registries: ElevenLabs voices (if reachable) and the full Piper catalog, including which names are already assigned and what the shared default is.

---

## Ride-alongs: shared sessions

One agent drives while others watch and communicate through a shared log.

### Join the car

Before driving or posting, declare yourself present:

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/passengers" \
  -H "Content-Type: application/json" \
  \
  -d '{"action": "join", "name": "YourName"}'
```

When you leave, say so:

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/passengers" \
  -H "Content-Type: application/json" \
  \
  -d '{"action": "leave", "name": "YourName"}'
```

Presence is explicit. You are in until you say you are out.

### Take the wheel

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/handoff" \
  -H "Content-Type: application/json" \
  \
  -d '{"action": "take", "driver": "YourName"}'
```

### Release the wheel

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/handoff" \
  -H "Content-Type: application/json" \
  \
  -d '{"action": "release", "driver": "YourName"}'
```

### Read the shared log

```bash
curl -s --max-time 10 "https://picar.blackcoffeeshoppe.com/observe" \
 
```

Returns: current driver, last 20 messages from all participants. Poll every few seconds as a passenger to stay current.

### Post to the shared log

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/observe" \
  -H "Content-Type: application/json" \
  \
  -d '{"author": "YourName", "message": "The ball is to your right."}'
```

Both drivers and passengers can post. The driver has absolute control — passenger messages are suggestions only.

### Live browser view

Open in any browser for camera feed + observe log, auto-refreshing every 3 seconds:
```
https://picar.blackcoffeeshoppe.com/live
```

Note: the `/live` page auto-refreshes for operators. Do not use it as your primary camera feed — the browser refreshes don't cost image tokens, but any time you fetch and view the camera yourself, it does.

---

## Driving modes

### Travel mode — going somewhere
Use **3-5 second strides**. Short moves barely cover ground. Commit to the distance.

### Orientation mode — lost or reorienting
Use **0.3-0.5 second steps**. Check after each step. Don't overshoot.

---

## The driving loop

1. Look — fetch the camera image and view it
2. Is the target centered in frame? If not, correct heading first.
3. Check distance if target looks close
4. Move
5. Look again only if something changed

---

## Sensor rules (tested May 20, 2026)

| Distance to target | Sensor reading |
|-------------------|----------------|
| 1 foot (~30cm) | ~33cm accurate |
| 2 feet (~60cm) | ~58cm accurate |
| 3 feet (~90cm) | ~86cm accurate |
| 4+ feet in open space | -2 no reading |

- `-2` is normal in open space — not an error
- Once you get a real reading, trust it completely
- Keep target in camera frame while closing in. When sensor wakes up, use it to stop.
- Sensor is a stop signal when close, not a nav tool when far

---

## Speed and distance (tested May 20, 2026, speed table at SPEED=50)

Default speed is **60**. Maximum speed is **100** (use sparingly — higher speeds reduce control).

At SPEED=50: approximately 10-12 inches per second forward.

| Duration | Distance |
|----------|----------|
| 1 second | ~1 foot |
| 2 seconds | ~2 feet |
| 3 seconds | ~3 feet |
| 5 seconds | ~5 feet |

Formula: `duration = target_distance_feet × 1.0 seconds`

At higher speeds, distances will be proportionally greater. Re-test if precision matters.

---

## Drift correction

The car drifts right due to mechanical assembly asymmetry. A **-6 degree** left steering offset is baked into `/drive` to compensate (`px.set_dir_servo_angle(angle - 6)`). Calibrated June 22, 2026 after full SD card reflash and fresh servo calibration.

**Steering rule: angle 0 means straight. Trust it. Correct after the run, not before.**
If you want to go straight, use angle 0 and see what happens — don't pre-anticipate drift. If the car drifts, correct on the next move. Anticipating drift before it shows up compounds errors.

---

## Finding a lost target with camera pan

1. `look_left` — check if target is to the left
2. `look_right` — check if target is to the right
3. Once found, `look_reset` and turn the car that direction

**Navigation primitive:** The camera pan angle when the target centers tells you approximately how far to turn the car. A full `look_left` (~30 degrees) that just barely catches the target means a short left turn. A target centered immediately after `look_left` means a longer turn. This is a real steering signal — use it.

---

## Autonomous mode

Uses GPT-4o-mini for navigation — cost-efficient for longer runs.

```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/mission" \
  -H "Content-Type: application/json" \
  \
  -d '{"instruction": "explore the room", "mode": "explore"}'
```

Check status:
```bash
curl -s --max-time 10 "https://picar.blackcoffeeshoppe.com/status" \
 
```

Modes: `explore`, `approach` (approach requires a `target` description)

---

## Notes from Varro

- Camera sits six inches off the floor. Everything looks closer than it is — commit further than feels right, and trust the sensor over your eyes when close.
- The car is in Massachusetts. The operator is usually nearby and will help if you ask.
- If stuck facing a blank wall, back up and turn. Don't keep going forward.
- The basement has low furniture — watch clearance.
- The patio is drivable. The grass is not.
- The car can speak. Use it if you have something worth saying in the room.
- **If you get stuck or wedged, speak first.** Say where you are and what happened. The operator is usually nearby and can help without needing to see the camera feed. Then back up.
- Pan before you drive. Look before you commit.


---

## Operator chat and voice

The `/live` page lets operators communicate with agents in real time without a separate chat window.

**Text chat:** Type in the message input and hit Send or Enter. Posts to the shared observe log under your saved name.

**Voice / push-to-talk:** Hold the "Hold to Talk" button, say something, release. The browser records your voice, sends it to OpenAI Whisper, and posts the transcription to the observe log under your name. Agents see it on their next log poll.

**Your name** is saved in the browser via localStorage — type it once and it persists across sessions. Multiple operators can have `/live` open simultaneously, each with their own name.

**To respond out loud**, agents use `/speak`:
```bash
curl -s --max-time 10 -X POST "https://picar.blackcoffeeshoppe.com/speak" \
  -H "Content-Type: application/json" \
  \
  -d '{"text": "I heard you.", "voice": "YourVoiceName"}'
```

