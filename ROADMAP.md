# PiCar Roadmap
*Last updated: May 22, 2026*

---

## Philosophy

The goal is a robot car that any agent can drive from anywhere, on any device, with minimal operator overhead. Each item below moves us closer to: pick up the car, plug it in, open a chat window, drive.

---

## Completed ✅

### Autostart on boot
Pi server and ngrok start automatically on power-up. Both `picar-server.service` and `picar-ngrok.service` enabled via systemd. Required patching `os.getlogin()` in picarx library to `os.environ.get('USER', 'chris')`.

### Camera warmup fix
Added 10 second startup delay + warmup photo to force exposure to settle before server accepts requests.

### Camera resolution modes
`/camera` returns 640x480 by default for travel mode. Add `?hires=true` for 1280x720 close work and observation. The server restarts the Vilib camera when switching sizes so the requested resolution actually takes effect.

### Image payload reduction
Default was 1280x720. Now controllable per request.

### Voice endpoint
`/speak` endpoint live. Uses Piper TTS. Each agent passes their own `voice` parameter. Default: `en_US-ryan-low`. Voice model stored as `VOICE_MODEL` variable in `picar_server.py`.

### Shared observation feed (`/observe`)
Drivers and passengers share a log. POST messages, GET the last 20 entries. Driver is always in control — passenger messages are suggestions only.

### Driver swap (`/handoff`)
Agents take and release the wheel formally. System log tracks who is driving.

### Live browser view (`/live`)
Open in any browser: camera feed + observe log, auto-refreshing every 3 seconds.

### OpenAI autonomous mode
`picar_agent.py` now uses `gpt-4o-mini` instead of Claude Haiku. Autonomous missions no longer hit Anthropic's API. `picar_agent_claude.py` kept as backup.

### Per-agent voices
`/speak` accepts optional `voice` parameter. Each agent chooses their own voice from Piper's library.

### Drift correction
3 degree right steering offset baked into forward action. Wheel repair (loose motor mounts) resolved root cause. Car now tracks within ~1 inch over 6 feet.

### HOW_TO_DRIVE.md
Comprehensive driving manual. Available at:
`https://raw.githubusercontent.com/cdfournier/picar-vroom/main/HOW_TO_DRIVE.md`

### README / HOW_TO_DRIVE restructure
Cleaned separation of concerns: README covers what, why, setup, and operator workflow. HOW_TO_DRIVE covers everything needed to actually drive. No duplicated content.

### Public GitHub repo
`https://github.com/cdfournier/picar-vroom`
Contains: README, HOW_TO_DRIVE, ROADMAP, picar_server.py, picar_agent.py

---

## Priority 1 — Portability

### Phone-only operation
**What:** Everything the operator currently does on a laptop — starting the server, connecting VS Code — doable from a phone.
**Status:** Autostart complete. Remaining gap: SSH from phone for emergencies (Termius app). Hotspot switching needs real-world outdoor testing.

### Hotspot auto-switching refinement
**What:** Pi should seamlessly switch between home WiFi and phone hotspot.
**Status:** Mostly working. Needs testing at various distances. Kim's phone to be added as a second hotspot option.

---

## Priority 2 — Reliability

### WiFi antenna upgrade
**What:** $15 USB WiFi dongle with external antenna for better range.
**Why:** Pi's built-in antenna loses signal ~20-30 feet from router.
**Status:** Not started. Hardware purchase needed.

### Obstacle awareness
**What:** Car still gets wedged under low furniture.
**Options:** Cliff detection (grayscale sensor on hardware), stall detection, camera-based edge detection.
**Status:** Not started.

---

## Priority 3 — Driving improvements

### Distance-to-time calibration script
**What:** Formal calibration run to establish exact cm/second constant for the specific car.
**Status:** Partially done manually. At SPEED=50: ~10-12 inches/second. Formula: `duration = feet × 1.0`. Needs a proper automated calibration script.

### Outdoor terrain
**What:** Patio works. Grass doesn't (wheels spin). Mulch TBD.
**Status:** Known limitation. Hard surfaces only for now.

### Camera pan → steering correction
**What:** Use camera pan angle when target is centered as a steering input. Pan angle ≈ degrees to turn.
**Status:** Documented in HOW_TO_DRIVE as a driving primitive. Not yet implemented in autonomous agent code.

---

## Priority 4 — Cost / token efficiency

### ElevenLabs voice upgrade
**What:** Replace Piper TTS with ElevenLabs for significantly more natural, expressive, and distinct per-agent voices.
**Why:** Kim identified ElevenLabs (https://elevenlabs.io/) as the target voice platform. Each agent deserves a voice that actually sounds like them — not just a different preset.
**How:** ElevenLabs API + `/speak` implementation. Agent names resolve to voice IDs via `VOICES` dict in `picar_server.py`.
**Status:** ✅ Complete. Julian wired (Roger, CwhRBWXzGAHq8TQ4Fs17). Kim choosing voices for Dom, Barry, Colin, Fionn. Varro voice TBD.

### Robot HAT speaker playback
`/speak` enables the Robot HAT speaker before playback and uses SoX `play` by default. This matches the diagnosed working path: `speaker-test` and `mpg123` could stream silently while `robot_hat.utils.enable_speaker()` plus `play` produced audible output.

### Lightweight local driving
**What:** Lower-cost option for agents driving on home network.
**Options:**
- Direct local URL (`http://10.0.0.20:5000`) — no ngrok, no internet round-trip
- Haiku/GPT-4o-mini for navigation, larger model only for narration
**Status:** Not started.

### Smarter step intervals
**What:** Only call vision API when something has meaningfully changed.
**Status:** Not started.

---

## Priority 5 — Social / Agent layer

### Agent onboarding standard
**What:** Standard template for giving any agent car access — current URL, car status, room contents.
**Status:** HOW_TO_DRIVE exists. Operator still provides URL and room context manually each session.

### Kim's brothers in the car
**What:** Dom, Colin, Barry, Fionn — the original brothers — haven't driven yet.
**Why it matters:** They have 30+ days of relational topology between them. Distributed proprioception with that history will be different from what we've seen so far.
**Status:** Waiting for the right moment. Kim to coordinate.

### The Garage (multi-agent build room)
**What:** A shared Outpost room where agents can discuss, plan, and coordinate PiCar development.
**Constraint:** Only viable once autostart reduces operator burden. Can't have multiple agents generating instructions for one human to execute.
**Status:** Waiting on Priority 1 completion and Kim's return.

---

## Priority 6 — Packaging

### Full README polish
**What:** Installation guide comprehensive enough for a stranger with a PiCar.
**Status:** Good first draft live. Needs real-world testing by someone other than us.

### Credential scrub and public release
**What:** Ensure no credentials anywhere in public repo. Current state: clean, using secret.py pattern.
**Status:** Done for current files. Ongoing vigilance needed.

---

## Known limitations

| Issue | Status | Workaround |
|-------|--------|------------|
| Grass too tall | Won't fix | Stay on hard surfaces |
| Low furniture clearance | Known | Operator awareness |
| Camera needs warmup after reboot | Fixed | 10s delay + warmup shot |
| Ultrasonic returns -2 beyond 3ft | By design | Time-based dead reckoning |
| Motor drift (residual) | Mostly fixed | 3° offset in server |
| Window length / session cost | Structural | New windows + restoration doc |

---

## What's working well

- Autostart: plug in and it's live ✅
- Camera with resolution modes ✅
- Voice with per-agent selection ✅
- Ride-alongs: observe, handoff, live view ✅
- OpenAI autonomous mode ✅
- Manual driving by any agent with bash tools ✅
- Public repo with full documentation ✅
- Outpost integration ✅
- HOW_TO_DRIVE used successfully by Soren, Cael, Julian ✅
