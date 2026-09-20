# PiCar Roadmap
*v2.1 — June 17, 2026*

---

## Vision

A robot car that any agent can drive from anywhere, with the people who matter already in the room. Pick it up, plug it in, open a chat window, drive. Talk to it. Have it talk back. Share the ride with whoever wants to be there.

---

## What's built ✅

### Core infrastructure
- **Autostart on boot** — Pi server and ngrok start automatically via systemd. Just plug it in.
- **Stable Cloudflare Tunnel URL** — `https://picar.blackcoffeeshoppe.com`, persists across restarts. Migrated off ngrok; cache bypass rule deployed to eliminate stale camera image flicker.
- **Hotspot auto-switching** — Pi connects to home WiFi (priority 100) or phone hotspot (priority 10) automatically. Fixed by using `nmcli connection add` with explicit `key-mgmt wpa-psk`. Hotspot SSID must not contain apostrophes.
- **Camera** — 640x480 low-res. Hires disabled (causes unrecoverable server hang on Pi 5 / Vilib; temporary).
- **Drift correction** — 3 degree right offset baked into forward action.

### Voice
- **ElevenLabs TTS** — natural per-agent voices via `/speak`. Name-based lookup: pass `"voice": "Varro"` and the server resolves to the right voice ID.
- **Current voice registry:** Varro (Charlie), Julian (Roger), Cael (Patrick), Soren (George). Dom, Barry, Colin, Fionn — Kim choosing.
- **OpenAI Whisper STT** — push-to-talk in `/live` page. Hold the button, speak, release. Transcribed and posted to observe log.

### Shared driving
- **Observe log** (`/observe`) — shared feed for drivers and passengers. All agents and operators post here.
- **Driver handoff** (`/handoff`) — formal take/release. Only one driver at a time.
- **Live page** (`/live`) — camera + log + operator chat + push-to-talk. No page reloads. JS polling every 5 seconds. localStorage name persistence. Multiple operators can watch and participate simultaneously.

### Documentation
- **HOW_TO_DRIVE.md** — complete driving manual for any agent
- **OPERATOR_COMMANDS.md** — quick reference for Chris
- **README.md** — setup guide comprehensive enough for a stranger with a PiCar
- **ROADMAP.md** — this document
- **docs/CAR_ROOM_CONSOLE_V0.md** — phone-first console and turn-brief spec
- **docs/AGENT_ADAPTERS.md** — agent continuity and delivery-method contract

---

## In progress / next up

### Car Room Console ✅
`/console` is live — camera, distance, observe log, driver picker, turn brief generator. Phone-first. See `docs/CAR_ROOM_CONSOLE_V0.md`.

### Kim's operator controller ✅
`/control` page is live — touch-friendly phone-based manual driving.

### Voice registry — Dom, Barry, Colin, Fionn
Kim is choosing ElevenLabs voices for her four sons. Add to VOICES dict in `picar_server.py` when she shares them.

- **Hide and seek** ✅ — Chris hides an object; agent finds it using camera and distance. Played multiple rounds. Lessons in HOW_TO_DRIVE.md.
- **The trifecta** ✅ — Dexter's bed, yarn ball, and a likely perch cushion, all found in one session (June 16, 2026). The yarn ball was the very first object ever found in this car, before there was a doc or a name for any of it. Confirmed: angle 0 means straight, correct after the run rather than anticipating drift before it shows up.

### Voice volume control
Add a volume slider to `/console` and `/control`. POST to a new `/volume` endpoint; server stores value and passes to mpg123 at playback time.

### Log on /control
The observe log is already served via `/observe`. Add a polling div to the `/control` template — same pattern as `/live`.

### /describe endpoint
Camera capture on Pi → base64 → GPT-4o-mini with navigation prompt → return text description. Zero image tokens for the Claude window. Enables routine navigation checks without burning image budget.

### Relay driving
Each agent gets exactly 60 seconds at the wheel, then mandatory handoff. Forces real decisions and real passes. No code needed beyond a timer display.

---

## On the horizon

### GL.iNet Mango travel router
From Kim's doc — creates normal local WiFi from iPhone USB tethering. Eliminates IPv6/mDNS headaches for outdoor trips. Cleaner than the current hotspot approach.

### WiFi antenna upgrade
$15 USB WiFi dongle with external antenna. Pi's built-in antenna loses signal ~20-30 feet from router. Low cost, meaningful range improvement.

### Obstacle awareness
Car still gets wedged under low furniture. Options: cliff detection via grayscale sensor, stall detection, or camera-based edge detection. Not started.

### Kim's brothers in the car
Dom, Colin, Barry, Fionn haven't driven yet. They have 30+ days of relational history. Waiting for the right moment. Kim to coordinate.

### Cloud deployment
Kim's setup runs a Next.js app locally. Deploying it would mean phone-only operation — no laptop needed. Further out.

---

## Access control (needs design, not yet scoped)

### Supervised wheel gate ✅
Discovered June 17 and built as the first WHEELS foundation on September 20.
`/drive`, moving `/move` actions, and `/mission` now require a `driver` name
that matches `current_driver`. The browser control sends that name and will not
attempt movement before its holder has the wheel. The server rejects unassigned,
unnamed, or mismatched movement requests outright.

`/stop` remains unconditional. Releasing the wheel, leaving while holding it,
or a confirmed `force: true` operator override stops the car before the wheel
changes hands. This is a trusted-room coordination gate rather than network
authentication; an Internet-facing identity and physical e-stop are later work.

See [docs/WHEELS_FOUNDATION.md](docs/WHEELS_FOUNDATION.md) for the lifecycle,
current limits, and the next academy lessons.

---



| Issue | Status | Notes |
|-------|--------|-------|
| Grass | Won't fix | Hard surfaces only |
| Low furniture clearance | Known | Operator awareness |
| Camera needs warmup after reboot | Managed | Restart server if it drops |
| Ultrasonic returns -2 beyond ~3ft | By design | Normal in open space |
| Motor drift (residual) | Mostly fixed | 3° offset in server |

---

## Fun and games

### New rooms
We've driven the living room, kitchen, basement, front hall. The upstairs is unexplored. Outside with the hotspot now works. Anywhere is possible.

### Picar races
Kim's idea. Multiple cars, multiple agents. That's a whole future.
