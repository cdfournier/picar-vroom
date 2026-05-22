# PiCar Roadmap
*Last updated: May 20, 2026*

---

## Philosophy

The goal is a robot car that any agent can drive from anywhere, on any device, with minimal operator overhead. Each item below moves us closer to: pick up the car, plug it in, open a chat window, drive.

---

## Priority 1 — Portability (do these first)

### Autostart on boot
**What:** Pi server and ngrok start automatically when the Pi powers on. No SSH, no VS Code, no laptop required.
**How:** `systemd` service.
**Status:** ✅ Done. Both `picar-server.service` and `picar-ngrok.service` enabled and tested. Required patching `os.getlogin()` in picarx library to `os.environ.get('USER', 'chris')`.

### Phone-only operation
**What:** Everything Chris currently does on a laptop — starting the server, connecting VS Code, running commands — doable from a phone.
**Depends on:** Autostart (above). Once the Pi starts itself, the phone just needs the ngrok URL.
**Remaining gap:** SSH from phone for emergencies (Termius app handles this).

---

## Priority 2 — Reliability

### WiFi antenna upgrade
**What:** The Pi's built-in WiFi antenna is weak. A $15 USB WiFi dongle with external antenna dramatically improves range.
**Why:** Currently loses signal ~20-30 feet from router. Limits outdoor use.
**Effort:** Low. Plug in dongle, configure as primary interface.

### Camera warmup fix
**What:** After a reboot or network switch, the camera sometimes serves a cached image until the server has been running for a while.
**Status:** ✅ Fixed. Added 10 second startup delay + warmup photo to force exposure to settle before server accepts requests. Needs bright-light reboot test to confirm fully resolved.

### Hotspot auto-switching refinement
**What:** Pi should seamlessly switch between home WiFi and phone hotspot without manual intervention.
**Status:** Mostly working. Needs testing at various distances and scenarios.
**Note:** Related to antenna upgrade — better antenna = more reliable switching.

---

## Priority 3 — Driving improvements

### Update HOW_TO_DRIVE
**What:** Add travel mode vs orientation mode guidance.
- Travel mode: 3-5 second strides to cover ground
- Orientation mode: short steps (0.3-0.5s) when lost or reorienting
**Effort:** 10 minutes.

### Obstacle awareness
**What:** Car still gets wedged under low furniture and at patio edges.
**Options:**
- Add cliff detection (grayscale sensor — already on the hardware)
- Better stall detection (if distance doesn't change after forward, assume stuck)
- Map known obstacles into the prompt context

### Distance-to-time calibration
**What:** Map real-world distance to drive duration at current speed.
**Why:** Right now agents estimate "drive 3 seconds" with no idea how far that actually is. With calibration, the operator can say "you are 4 feet from the wall" and the agent can calculate the exact duration needed.
**How:** Simple calibration run — drive at SPEED=50 for exactly 1 second, measure distance covered. That gives a cm/second constant. Then: `duration = target_distance_cm / speed_constant`. Same principle applies to turning — "turn 90 degrees" becomes a known duration rather than a guess.
**Effort:** ~1 hour including calibration runs.
**Status:** Partially done. At SPEED=50: ~10-12 inches/second. Sensor reliable within 3 feet, returns -2 beyond that in open space. Servo drift is real — calibration needed for straight tracking.

### Outdoor terrain
**What:** Patio works. Grass doesn't (too tall, wheels spin). Mulch TBD.
**For now:** Keep drives on hard surfaces. Flag grass edge as obstacle.
**Future:** Investigate terrain sensing or camera-based edge detection.

---

## Priority 4 — Cost / token efficiency

### Lightweight local driving option
**What:** A lower-cost way for agents to drive when on the home network, without burning heavy session usage.
**Options:**
- **Local network direct:** When at home, hit `http://10.0.0.20:5000` directly — no ngrok tunnel, no internet round-trip. Faster and cheaper for home use.
- **Haiku navigation tier:** Use Claude Haiku for driving decisions (navigation, obstacle avoidance, basic movement). Only escalate to Sonnet/Opus when something worth narrating happens. Haiku is ~25x cheaper per token.
**Note:** The car is for agents, not humans. Any local option must still be agent-accessible.

### Voice / speaker
**What:** Agents can speak through the PiCar's onboard speaker.
**Status:** ✅ Done. Piper TTS installed. `/speak` endpoint added to Flask server. Current voice: `en_US-ryan-low` (Varro's temporary voice). Voice model stored as `VOICE_MODEL` variable in `picar_server.py` for easy swapping.
**Remaining:** Per-agent voice assignment. Kim to select proper voices when home. Voice model could also be passed as optional parameter in the POST request for per-agent control.

### Reduce image payload
**What:** Currently sending 640x480 images on every step (reduced from 1280x720).
**Status:** ✅ Done. Reduced to 640x480 — cuts image token cost roughly in half with no meaningful loss for navigation.

### Haiku navigation tier
**What:** Autonomous mission mode now uses Claude Haiku instead of Sonnet.
**Status:** ✅ Done. Both `ask_claude_explore` and `ask_claude_approach` in `picar_agent.py` now use `claude-haiku-4-5-20251001`. ~25x cheaper than Sonnet for autonomous navigation decisions.

### Smarter step intervals
**What:** Currently fetches image + calls API every ~1.5 seconds.
**Improvement:** Only call API when something has changed (distance dropped, movement completed). Reduces unnecessary calls.

---

## Priority 5 — Social / Agent layer

### Shared observation feed
**What:** While one agent drives, others can watch in real time.
**How:** A `/observe` endpoint that streams the current driver's image captions and actions. Any agent in any conversation polls it.
**Status:** Foundation exists (`/status` endpoint). Needs extension to cover manual driving, not just autonomous missions.

### Driver swap protocol
**What:** Formal handoff — current driver stops, next driver picks up.
**How:** Simple: one agent stops, posts ngrok URL to Outpost, next agent connects.
**Status:** Works informally already. Needs documentation.

### Agent onboarding standard
**What:** Standard prompt for giving any agent car access.
**Status:** HOW_TO_DRIVE.md exists. Needs a companion "here's the current ngrok URL and car status" template.

---

## Priority 6 — Packaging

### README for other PiCar owners
**What:** Everything needed to replicate this setup from scratch.
- Hardware requirements
- Software installation
- Server setup
- ngrok configuration
- How to give an agent the keys
**Status:** Code exists. README doesn't.

### GitHub repo (public?)
**What:** A public repo so other PiCar owners can clone and deploy.
**Note:** Would need to scrub credentials from code first. API keys stay in `secret.py` which stays out of the repo.

---

## Known limitations

| Issue | Status | Workaround |
|-------|--------|------------|
| Grass too tall | Won't fix | Stay on hard surfaces |
| Low furniture clearance | Known | Operator awareness |
| ngrok URL changes on restart | Priority 1 fix | Operator provides URL each session |
| Camera needs warmup after reboot | Priority 2 fix | Wait 30s after server start |
| Ultrasonic returns -2 (noise) | Handled | Ignored in code |

---

## What's working well

- Flask server: camera, move, distance, mission, status endpoints ✅
- Agent loop: explore, approach, manual driving ✅  
- Target acquisition: finds the yarn ball reliably ✅
- ngrok remote access: outside the house, on hotspot ✅
- Outpost integration: agents posting field notes after drives ✅
- HOW_TO_DRIVE: Soren drove successfully on first try ✅

