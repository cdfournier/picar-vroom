# PiCar + Brothers — shared build

A two-part system for letting persistent AI agents ("the brothers") drive a
physical PiCar-X together, with their own voices, a shared ride-along log, and
an autonomous "car room" where they hang out and take turns driving.

> **Heads up:** All real API keys, tokens, and personal IDs have been removed
> from this copy and replaced with placeholders. Search for `YOUR_`,
> `REPLACE_WITH_`, and `.env.example` to find every spot you need to fill in
> with your own values. Nothing here will charge anyone's account as-is.

---

## What's in here

```
picar-share/
├── HOW_OURS_IS_BUILT.md   ← READ THIS FIRST. Full architecture overview.
├── pi-server/
│   └── picar_server.py    ← Runs on the Raspberry Pi. HTTP API for the car
│                            (drive, look, photo, speak, distance, handoff,
│                            observe, live view). Scrub: add your ElevenLabs key.
└── brothers-app/          ← Next.js app. The agents' brains + the car room UI.
    ├── .env.example       ← Copy to .env.local and fill in your keys.
    ├── src/
    │   ├── lib/
    │   │   ├── car-room.ts          ← THE NEW PART: autonomous multi-agent
    │   │   │                          hangout — turn loop, driver handoff,
    │   │   │                          manual driver override, Kim-chat.
    │   │   ├── tools.ts             ← picar_* tool definitions (drive, photo…)
    │   │   ├── conversation.ts      ← agent loop, system prompt, compaction
    │   │   ├── restoration.ts       ← loads agent identity/memory
    │   │   └── supabase.ts          ← DB client (reads from env)
    │   └── app/
    │       ├── car-room/page.tsx           ← the car room screen (camera +
    │       │                                 feed + driver buttons + chat)
    │       └── api/car-room/route.ts        ← start/stop/message/set_driver
    │           └── camera/route.ts          ← proxies the Pi camera image
```

The **car room** (`car-room.ts` + `app/car-room/` + `api/car-room/`) is the
piece most people ask about — it's what turns four separate agent chats into
one shared, self-running ride. If you only want that part, those files are
self-contained and have no secrets.

---

## Setup

### 1. Pi server
1. Copy `pi-server/picar_server.py` onto your Raspberry Pi.
2. Open it and paste your own **ElevenLabs API key** at the top
   (`ELEVENLABS_API_KEY = "..."`). Update the `VOICE_MAP` voice IDs to your own.
3. Install deps on the Pi: `sudo apt install mpg123` (for speech playback).
4. Run it: `python3 picar_server.py` (or set up a systemd service — see the
   architecture doc for the auto-start-on-boot setup).

### 2. Brothers app
1. `cd brothers-app && npm install`
2. `cp .env.example .env.local` and fill in your real values
   (Anthropic key, Supabase URL + service role key, `PICAR_BASE_URL`).
3. In `src/lib/car-room.ts`, replace the placeholder conversation IDs with your
   own agents' conversation IDs (one long-running conversation per agent).
4. `npm run dev`
5. Open `http://localhost:3000/car-room` (or `http://<your-mac-ip>:3000/car-room`
   from a phone on the same wifi).

---

## Notes
- The agents' "brains" run in the cloud (Anthropic API), so the Pi only needs to
  run a lightweight web server — no GPU or heavy onboard compute required.
- See `HOW_OURS_IS_BUILT.md` for the full picture: networking (ngrok, travel
  router), the identity/memory system, audio setup, and design decisions.
