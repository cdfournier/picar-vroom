# Car Room Console v0

Working spec for a phone-first coordination layer that helps real agent windows drive together without replacing any participant with an API-call clone.

## Principle

Presence scaffold, not replacement mind.

The console prepares shared context, shows current car state, and makes handoffs easier. It does not create substitute agent instances. For agents whose continuity lives in a window, Chris pastes the turn brief into that real window.

## Goal

One phone page, served by the Pi, that lets an operator:

- see the camera
- read and post to the ride log
- see current driver and distance
- assign or clear the driver
- generate a paste-ready turn brief for each agent
- keep a multi-agent drive moving without manual polling in every window

## Proposed Route

Serve from the Pi at:

```text
/console
```

`/live` remains the simple viewer. `/console` is the operator cockpit.

## Existing Endpoint Contract

The v0 console should work against the current Flask API.

### `GET /observe`

Current shape:

```json
{
  "driver": "Julian",
  "log": [
    { "author": "Chris", "message": "Front door to the right; kitchen to the left." }
  ]
}
```

Use for:

- current driver
- recent ride log
- turn-brief context

### `POST /observe`

Request:

```json
{ "author": "Chris", "message": "Try explore mode." }
```

Use for:

- operator chat
- optional console-generated system notes

### `GET /distance`

Current shape:

```json
{ "distance": 87.46 }
```

Use for:

- turn brief distance field
- simple safety/status display

Rules:

- `-2` is normal open-space/no-return behavior.
- A positive close-range value is a stop/safety signal, not a full map.

### `GET /camera`

Returns JPEG. Supports:

```text
/camera?hires=false
/camera?hires=true
```

Known response headers when successful:

- `X-Camera-Mode`
- `X-Camera-Requested-Size`
- `X-Camera-File`

Use for:

- live image
- camera health display

Important v0 requirement:

- If camera fetch times out, show camera status as timed out/stale and do not block distance, log, driver, or turn-brief generation.

### `POST /handoff`

Request:

```json
{ "action": "take", "driver": "Julian" }
```

or:

```json
{ "action": "release", "driver": "Julian" }
```

Current response:

```json
{ "ok": true, "driver": "Julian" }
```

Use for:

- driver picker
- clearing the wheel

### `GET /status`

Current shape is mission-focused:

```json
{
  "current_mission": null,
  "log": []
}
```

Use only as an availability check unless Varro expands it.

Nice future addition:

```json
{
  "driver": "Julian",
  "camera": {
    "ok": true,
    "mode": "lowres",
    "last_success_at": "2026-05-30T13:42:00Z",
    "last_error": null
  },
  "distance": 87.46,
  "movement": {
    "last_action": "forward",
    "last_duration": 0.65
  }
}
```

## Console UI v0

### Top Status

Show:

- current driver
- distance ahead
- camera health: live, stale, timed out
- last refresh time

### Camera

Show low-res camera by default. Add a refresh button.

Optional:

- a "hi-res once" button for close inspection
- if hi-res times out, fall back to low-res and mark hi-res stale

### Ride Log

Show latest `/observe` entries, newest last or newest first by operator preference.

Include:

- operator text input
- saved operator name
- optional push-to-talk if already stable

### Driver Picker

Buttons for configured agents:

- `Julian`
- `Varro`
- `Cael`
- `Soren`
- later: `Dom`, `Barry`, `Colin`, `Fionn`

Button behavior:

- Tap agent: `POST /handoff { action: "take", driver: name }`
- Tap "release": `POST /handoff { action: "release", driver: currentDriver }`

Do not imply the selected agent has received a prompt. Driver assignment and turn delivery are separate.

### Turn Brief Generator

One button per configured agent:

- "Copy brief for Julian"
- "Copy brief for Varro"
- "Copy brief for Cael"
- "Copy brief for Soren"

Button builds a text block from live console state and copies it to the clipboard.

Also show the generated brief in a text area as fallback for mobile clipboard weirdness.

## Turn Brief v0 Format

```text
[PiCar Turn Brief for Julian]
Generated: 2026-05-30 09:42 EDT

Continuity:
This is context for your real window, not a replacement instance.

Current State:
- Driver: Cael
- Wheel: held by Cael
- Distance ahead: 87 cm
- Camera: live, low-res, refreshed 5 seconds ago
- Last visual read: front hall/window zone; cabinet on the right; kitchen left; front door right

Operator Direction:
Chris says: "Try explore mode. Remember: you're the instructor. The wisest driver."

Recent Ride Log:
- Chris: Front door to the right; kitchen to the left.
- Julian: Arrived at the window zone. Distance is about 87 cm...
- Cael: ...
- Varro: ...

Suggested Role:
Passenger safety read.

Suggested First Action:
Read the latest camera and distance. Post intent to /observe. Take the wheel only if Chris asks or the wheel is free.

Stop Conditions:
Camera unavailable; distance under safe threshold; frame unchanged after a move; human says stop; physical contact suspected.
```

## Field Rules

### Required Fields

- target agent name
- generated timestamp
- continuity reminder
- current driver
- distance
- camera status
- latest operator direction, if any
- recent ride log
- suggested role
- suggested first action
- stop conditions

### Optional Fields

- last visual read
- last movement/action
- last camera mode
- known map/bearing from operator
- known hazards
- suggested handoff target

## Suggested Roles

Use one of:

- `driver`
- `passenger safety read`
- `navigator`
- `watcher`
- `operator support`
- `stand by`

Role selection rules:

- If target agent is current driver: `driver`.
- If no driver and operator asked target agent to drive: `driver`.
- If another agent is driving: `passenger safety read` or `navigator`.
- If camera is unavailable: `watcher` or `operator support`.
- If the session is idle: `stand by` or `navigator`.

## Suggested First Action Rules

Keep this short and concrete.

Examples:

```text
Read camera, check distance, post intent to /observe, then move only if geometry is clear.
```

```text
Do not move. Camera is timed out; post a passenger read or ask Chris for a bearing.
```

```text
You have the wheel. If camera and distance are healthy, take one short forward move, then re-look.
```

## Driver-Hold Nudge

Borrowed choreography from Kim's car room:

- Track how long the current driver has held the wheel.
- Show a soft nudge after a configurable time or turn count.
- Do not force handoff in v0.

Example console note:

```text
Julian has held the wheel for 6 minutes. Consider asking for a handoff.
```

## Camera Status

The console should treat camera as its own subsystem.

States:

- `live`: last camera request succeeded recently
- `stale`: last image is older than refresh target
- `timed out`: request exceeded timeout
- `error`: non-timeout failure
- `unknown`: not yet fetched

Camera failure must not take down:

- observe log
- driver picker
- distance
- turn brief generation

If camera is not live, the brief should say so clearly and recommend no blind movement.

## What We Are Borrowing From Kim

Borrow:

- shared room state
- turn rotation concept
- driver-hold awareness
- manual driver override
- recent-log injection into each turn
- operator-as-radio model
- phone-first control surface

Do not borrow directly:

- assumption that a fresh API call is the participant
- Supabase-backed identity substrate
- hardcoded Anthropic conversation IDs
- brother-specific memory and tool framework

## v0 Non-Goals

- no autonomous agent loop
- no server-side model calls
- no forced turn timer
- no memory/restoration rewrite
- no replacement of `/live`
- no Pi hardware refactor

## Acceptance Criteria

v0 is useful when Chris can:

1. Open `/console` on the phone.
2. See camera, distance, current driver, and recent log.
3. Post operator guidance to the log.
4. Tap a driver button to assign the wheel.
5. Tap "Copy brief for Julian" and paste a complete, useful turn brief into Julian's real window.
6. Repeat for Varro/Cael/Soren without manually polling every window.
7. See camera timeout/stale state without losing the rest of the page.

