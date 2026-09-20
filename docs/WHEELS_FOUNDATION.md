# WHEELS Foundation — Supervised Wheel Gate v0

WHEELS begins with the driving academy, not a trip. Before expanding rooms,
routes, or autonomy, the car needs one legible agreement: a person who has the
wheel is the person who can move it.

## What this slice establishes

- A movement request must identify a `driver`.
- The server allows `/drive`, moving `/move` actions, and `/mission` only when
  that name matches the active wheel holder.
- `POST /stop` remains unconditional. Anyone who can reach the trusted car
  network can stop it.
- Releasing the wheel, leaving while holding it, or an explicit supervised
  override stops the car before the wheel changes hands.
- The browser controller sends the current driver's name and refuses to start
  movement before it has the wheel.
- The console's replacement-driver confirmation becomes an explicit
  `force: true` override rather than an invisible overwrite.

This is coordination and attribution, not Internet-grade identity security.
The car remains a trusted, operator-supervised system.

## Lifecycle

| Moment | Server behavior | Movement allowed? |
|---|---|---|
| Wheel unassigned | No active driver | No |
| Driver takes wheel | Driver is recorded and present in the ride log | Only that driver |
| Another driver asks normally | Request is rejected | No |
| Operator confirms override | Car stops, then wheel transfers | New driver only |
| Driver releases or leaves | Car stops, wheel clears | No |
| Anyone presses Stop | Car stops | Stop is always allowed |

## Deliberately not claimed yet

- Authentication: the `driver` name is an accountable coordination identity,
  not a credential.
- Physical e-stop hardware: the web stop is valuable, but not a substitute for
  a physical emergency control near the car.
- Stale-driver expiry: presence is explicit but is not yet heartbeated.
- Route or autonomy policy: autonomous missions now use the same named-driver
  gate, but their higher-level navigation policy is a later academy lesson.

## Known outdoor-readiness blocker: iPhone hotspot

The PiCar has not yet successfully joined Chris's iPhone hotspot. The existing
NetworkManager configuration documents a hotspot fallback, but that is not the
same as a verified field connection.

Do not treat outdoor driving as ready until a supervised check proves that the
Pi can join the real iPhone hotspot, retain the Cloudflare route, and recover
back to home Wi-Fi without manual repair. When we investigate, capture the
actual `nmcli` state and connection logs first; do not guess at the failure
mode from the old configuration.

## Safe next lessons

1. Readiness check: camera, distance, connection, operator presence, and a
   clear wheel state before a drive starts.
2. Stale-driver policy: a soft nudge, then a supervised release path.
3. Academy drills: indoor orientation, short controlled moves, handoff, and
   exit ritual.
4. Outdoor readiness: network path, terrain constraints, range, and a
   dedicated abort plan — beginning with the unverified iPhone hotspot path.

The gate is intentionally small. It gives every later WHEELS feature something
real to stand on without pretending the academy is already finished.
