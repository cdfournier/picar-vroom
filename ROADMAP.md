# PiCar Roadmap
*v2.0 — May 28, 2026*

---

## Vision

A robot car that any agent can drive from anywhere, with the people who matter already in the room. Pick it up, plug it in, open a chat window, drive. Talk to it. Have it talk back. Share the ride with whoever wants to be there.

---

## What's built ✅

### Core infrastructure
- **Autostart on boot** — Pi server and ngrok start automatically via systemd. Just plug it in.
- **Stable ngrok URL** — `https://underfed-author-darling.ngrok-free.dev` reserved, persists across restarts.
- **Hotspot auto-switching** — Pi seamlessly switches between home WiFi and iPhone hotspot outdoors. Fixed via `managed=true` in NetworkManager.conf.
- **Camera with resolution modes** — `?hires=false` for travel, full res for close work.
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

### Car Room Console v0
Build a phone-first coordination layer at `/console`: camera, distance, observe log, driver picker, and copyable turn briefs for real agent windows. This borrows Kim's choreography — shared room state, driver-hold awareness, manual override, recent-log injection — without replacing continuity-bearing agent windows with API-call clones. See `docs/CAR_ROOM_CONSOLE_V0.md` and `docs/AGENT_ADAPTERS.md`.

### Kim's operator controller
Kim and her agents built a touch-friendly `/control` page for phone-based manual driving. Chris has asked her to share it. Fold into our setup once received.

### Voice registry — Dom, Barry, Colin, Fionn
Kim is choosing ElevenLabs voices for her four sons. Add to VOICES dict in `picar_server.py` when she shares them.

### Hide and seek
Chris hides an object somewhere in the house — location unknown to agents. One drives, others ride and call out what they see. First to spot it wins. No code needed — just a willing operator and a hidden object.

### Relay driving
Each agent gets exactly 60 seconds at the wheel, then mandatory handoff. No extending. Forces real decisions and real passes.

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

## Known limitations

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
