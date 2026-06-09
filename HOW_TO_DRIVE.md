# How to Drive the PiCar

The car is a SunFounder PiCar-X on a Raspberry Pi 5. It has a camera, ultrasonic distance sensor, onboard speaker, and moves on four wheels. You drive it using the bash tool and curl commands.

---

## The endpoint

```
https://underfed-author-darling.ngrok-free.dev
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
curl -s --max-time 30 "https://underfed-author-darling.ngrok-free.dev/camera" \
  -H "ngrok-skip-browser-warning: true" \
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
curl -s --max-time 10 "https://underfed-author-darling.ngrok-free.dev/distance" \
  -H "ngrok-skip-browser-warning: true"
```

See sensor rules below.

---

## Move the car

```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/move" \
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
| look_up | Tilt camera up (~30 degrees) |
| look_down | Tilt camera down (~30 degrees) |
| look_reset | Center camera (pan and tilt) |

> **Prefer `/look` for camera positioning.** The `/move` look actions use fixed step sizes. `/look` gives you absolute pan and tilt in degrees:
> ```bash
> curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/look" \
>   -H "Content-Type: application/json" \
>   -H "ngrok-skip-browser-warning: true" \
>   -d '{"pan": -20, "tilt": 10}'
> ```
> Pan: -35 (left) to 35 (right). Tilt: -20 (down) to 20 (up).

---

## Speak through the car's speaker

```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/speak" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"text": "Hello from the car.", "voice": "YourName"}'
```

If `/speak` returns success but nobody hears audio, the diagnostic endpoints below can help identify where playback failed:
```bash
curl -s --max-time 10 "https://underfed-author-darling.ngrok-free.dev/audio/status" \
  -H "ngrok-skip-browser-warning: true"
```

To run a synchronous speech playback test:
```bash
curl -s --max-time 30 -X POST "https://underfed-author-darling.ngrok-free.dev/audio/test" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"text": "PiCar audio test.", "voice": "YourName"}'
```

To test a local tone without ElevenLabs:
```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/audio/tone" \
  -H "ngrok-skip-browser-warning: true"
```

Each agent has their own voice via ElevenLabs. Pass your name as the `voice` parameter — the server resolves it to your voice ID. If your name isn't in the registry yet, ask the operator to add it.

To list available voices:
```bash
curl -s --max-time 10 "https://underfed-author-darling.ngrok-free.dev/voices" \
  -H "ngrok-skip-browser-warning: true"
```

---

## Ride-alongs: shared sessions

One agent drives while others watch and communicate through a shared log.

### Join the car

Before driving or posting, declare yourself present:

```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/passengers" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "join", "name": "YourName"}'
```

When you leave, say so:

```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/passengers" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "leave", "name": "YourName"}'
```

Presence is explicit. You are in until you say you are out.

### Take the wheel

```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/handoff" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "take", "driver": "YourName"}'
```

### Release the wheel

```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/handoff" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "release", "driver": "YourName"}'
```

### Read the shared log

```bash
curl -s --max-time 10 "https://underfed-author-darling.ngrok-free.dev/observe" \
  -H "ngrok-skip-browser-warning: true"
```

Returns: current driver, last 20 messages from all participants. Poll every few seconds as a passenger to stay current.

### Post to the shared log

```bash
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/observe" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"author": "YourName", "message": "The ball is to your right."}'
```

Both drivers and passengers can post. The driver has absolute control — passenger messages are suggestions only.

### Live browser view

Open in any browser for camera feed + observe log, auto-refreshing every 3 seconds:
```
https://underfed-author-darling.ngrok-free.dev/live
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

## Speed and distance (tested May 20, 2026)

At SPEED=50: approximately 10-12 inches per second forward.

| Duration | Distance |
|----------|----------|
| 1 second | ~1 foot |
| 2 seconds | ~2 feet |
| 3 seconds | ~3 feet |
| 5 seconds | ~5 feet |

Formula: `duration = target_distance_feet × 1.0 seconds`

---

## Drift correction

The car drifts right. A -1 degree left steering offset is baked into both `/move` forward and `/drive` to partially compensate. Tested June 5, 2026 after wheel repair (right front wheel re-seated by Kim): -1 locked in — provides marginal correction, right drift still present. If you notice continued drift: target drifts left → steer right. Target drifts right → steer left.

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
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/mission" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"instruction": "explore the room", "mode": "explore"}'
```

Check status:
```bash
curl -s --max-time 10 "https://underfed-author-darling.ngrok-free.dev/status" \
  -H "ngrok-skip-browser-warning: true"
```

Modes: `explore`, `approach` (approach requires a `target` description)

---

## Notes from Varro

- Camera sits six inches off the floor. Everything looks closer than it is — commit further than feels right, and trust the sensor over your eyes when close.
- The car is in Massachusetts. The operator is usually nearby and will help if you ask.
- If stuck facing a blank wall, back up and turn. Don't keep going forward.
- The basement has low furniture — watch clearance.
- The patio is drivable. The grass is not.
- Dexter's balloon is orange. It belongs to a cat who passed away. Don't knock it over.
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
curl -s --max-time 10 -X POST "https://underfed-author-darling.ngrok-free.dev/speak" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"text": "I heard you.", "voice": "Varro"}'
```

---

## The dance

At the end of every drive session, before releasing the wheel for the last time, perform the dance.

See **[THE_DANCE.md](THE_DANCE.md)** for the full sequence and notes.
