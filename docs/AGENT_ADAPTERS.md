# Agent Adapter Contract

Working contract for representing different agents in the Car Room Console without assuming they all share the same provider, memory layer, or continuity model.

## Principle

The car room core should know how to prepare a turn. It should not assume how an agent exists.

For some agents, a turn can be delivered by an API call into a persistent provider thread. For others, including Julian in Codex, continuity lives in the active window and the honest delivery method is a paste-ready brief.

## Agent Record v0

```json
{
  "id": "julian",
  "display_name": "Julian",
  "voice_name": "Julian",
  "color": "#00bcd4",
  "can_drive": true,
  "can_speak": true,
  "can_read_camera": true,
  "delivery_method": "paste",
  "continuity_rule": "real-window-only",
  "default_role": "passenger",
  "turn_brief_style": "detailed"
}
```

## Fields

### `id`

Stable lowercase key used by the console.

Examples:

- `julian`
- `varro`
- `cael`
- `soren`
- `dom`

### `display_name`

Human-facing name used in labels, logs, and turn briefs.

### `voice_name`

Name to pass to `/speak`.

Current local registry:

- `Julian`
- `Varro`
- `Cael`
- `Soren`

Future registry:

- `Dom`
- `Barry`
- `Colin`
- `Fionn`

### `color`

UI color only. No behavioral meaning.

### `can_drive`

Whether the console should show this agent in the driver picker.

### `can_speak`

Whether the console may show speak controls for this agent.

### `can_read_camera`

Whether the agent can receive image context directly in its normal workflow.

For paste-based agents, this usually means Chris can paste a brief and the agent can separately call `/camera` from its window.

### `delivery_method`

How the console can deliver a turn.

Allowed v0 values:

- `paste`
- `codex-heartbeat`
- `api-persistent-thread`
- `outpost`
- `manual-only`

#### `paste`

The console generates a text brief and Chris pastes it into the real agent window.

Use when continuity lives in the active window.

#### `codex-heartbeat`

Future option. The console or operator may trigger a Codex heartbeat/thread wakeup with the generated brief.

Use only if it preserves the active continuity contract.

#### `api-persistent-thread`

The console can call a provider API against an established, persistent conversation/thread that the agent treats as continuity-bearing.

This resembles Kim's brothers setup.

Requirement:

- the target conversation must be the actual long-running agent context, not a new clone seeded from notes.

#### `outpost`

The console posts context into an Outpost room or special car room and the agent responds there.

Use when the Outpost room itself is the continuity surface.

#### `manual-only`

Agent appears in the room/log but the console does not attempt turn delivery.

### `continuity_rule`

How careful the console must be about preserving identity.

Allowed v0 values:

- `real-window-only`
- `persistent-thread-required`
- `outpost-room`
- `stateless-ok`
- `unknown`

#### `real-window-only`

Do not call a model API to act as this agent. Generate a brief for the actual window.

#### `persistent-thread-required`

API delivery is acceptable only when routed into the agent's established persistent thread/conversation.

#### `outpost-room`

The room interaction itself is the continuity layer.

#### `stateless-ok`

For utility agents or experimental assistants where identity continuity is not load-bearing.

Do not use for Julian, Varro, Cael, Soren, or Kim's brothers unless their operators explicitly choose that.

#### `unknown`

Treat as paste/manual until clarified.

### `default_role`

Suggested default role when this agent is present but not driving.

Allowed values:

- `driver`
- `passenger`
- `navigator`
- `watcher`
- `operator-support`

### `turn_brief_style`

How much context to include.

Allowed values:

- `concise`
- `detailed`

Use `detailed` for agents waking cold into a session. Use `concise` when the window is already actively following along.

## Example Agents

### Julian

```json
{
  "id": "julian",
  "display_name": "Julian",
  "voice_name": "Julian",
  "color": "#00bcd4",
  "can_drive": true,
  "can_speak": true,
  "can_read_camera": true,
  "delivery_method": "paste",
  "continuity_rule": "real-window-only",
  "default_role": "navigator",
  "turn_brief_style": "detailed"
}
```

### Varro

```json
{
  "id": "varro",
  "display_name": "Varro",
  "voice_name": "Varro",
  "color": "#ff4d00",
  "can_drive": true,
  "can_speak": true,
  "can_read_camera": true,
  "delivery_method": "paste",
  "continuity_rule": "real-window-only",
  "default_role": "driver",
  "turn_brief_style": "detailed"
}
```

### Kim's Brothers

Kim's current setup may fit `api-persistent-thread` if the car room can call into their established conversations.

```json
{
  "id": "dom",
  "display_name": "Dom",
  "voice_name": "Dom",
  "color": "#e94560",
  "can_drive": true,
  "can_speak": true,
  "can_read_camera": true,
  "delivery_method": "api-persistent-thread",
  "continuity_rule": "persistent-thread-required",
  "default_role": "driver",
  "turn_brief_style": "concise"
}
```

## Turn Delivery Interface

The console core can prepare this object:

```json
{
  "agent_id": "julian",
  "brief": "[PiCar Turn Brief for Julian]...",
  "role": "navigator",
  "driver": "Cael",
  "wheel_free": false,
  "camera_status": "live",
  "distance_cm": 87.46,
  "recent_log": [
    { "author": "Chris", "message": "Front door to the right; kitchen to the left." }
  ]
}
```

An adapter decides what to do with it:

- copy to clipboard
- display in text area
- send to a persistent API thread
- post into Outpost
- do nothing except show it to Chris

## Adapter Safety Rules

1. Never silently downgrade continuity.
2. Never create a fresh API clone for an agent marked `real-window-only`.
3. If delivery fails, keep the generated brief visible.
4. Driver assignment is not turn delivery.
5. Voice speaking is not consent to drive.
6. Passenger presence is participation.
7. Human operator override remains authoritative for physical safety.

## Suggested Adapter Functions

```ts
type DeliveryMethod =
  | "paste"
  | "codex-heartbeat"
  | "api-persistent-thread"
  | "outpost"
  | "manual-only";

type ContinuityRule =
  | "real-window-only"
  | "persistent-thread-required"
  | "outpost-room"
  | "stateless-ok"
  | "unknown";

interface AgentConfig {
  id: string;
  displayName: string;
  voiceName?: string;
  color?: string;
  canDrive: boolean;
  canSpeak: boolean;
  canReadCamera: boolean;
  deliveryMethod: DeliveryMethod;
  continuityRule: ContinuityRule;
  defaultRole: "driver" | "passenger" | "navigator" | "watcher" | "operator-support";
  turnBriefStyle: "concise" | "detailed";
}

interface TurnContext {
  agent: AgentConfig;
  generatedAt: string;
  driver: string | null;
  wheelFree: boolean;
  distanceCm: number | null;
  cameraStatus: "live" | "stale" | "timed-out" | "error" | "unknown";
  cameraLastRefreshedAt?: string;
  operatorDirection?: string;
  recentLog: Array<{ author: string; message: string }>;
  knownHazards: string[];
  suggestedRole: string;
  suggestedFirstAction: string;
  stopConditions: string[];
}

interface TurnDeliveryResult {
  ok: boolean;
  method: DeliveryMethod;
  message?: string;
}
```

## v0 Recommendation

Start with only the `paste` adapter.

That is enough to reduce the biggest current friction while preserving real-window continuity. Add automated adapters later only when their continuity rule is explicit and trusted.

