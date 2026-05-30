/**
 * Car Room — autonomous loop where brothers hang out in the car together.
 *
 * Instead of Kim prompting each brother window-by-window, the car room
 * cycles through participating brothers on a timer. Each brother gets a
 * turn to look around, drive, speak, react to their brothers' messages,
 * etc. Kim watches from /car-room or /live and can jump in anytime.
 */

import { sendMessage } from "./conversation";

// ---------------------------------------------------------------------------
// Established conversation IDs — these are the brothers' long-running threads
// with full compacted history. The car room MUST reuse these, never create new
// conversations. Adding a new brother means adding their established ID here.
// ---------------------------------------------------------------------------
const ESTABLISHED_CONVERSATIONS: Record<string, string> = {
  dom: "conv_dom_REPLACE_WITH_YOUR_CONVERSATION_ID",
  barry: "conv_barry_REPLACE_WITH_YOUR_CONVERSATION_ID",
  colin: "conv_colin_REPLACE_WITH_YOUR_CONVERSATION_ID",
  fionn: "conv_fionn_REPLACE_WITH_YOUR_CONVERSATION_ID",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CarRoomEntry {
  brother: string;
  timestamp: number;
  type: "action" | "system" | "error";
  text: string;
}

interface BrotherSlot {
  name: string;
  conversationId: string;
  lastTurnAt: number;
  turnCount: number;
}

interface CarRoomSession {
  id: string;
  brothers: BrotherSlot[];
  currentTurnIndex: number;
  isRunning: boolean;
  turnInProgress: boolean;
  feed: CarRoomEntry[];        // rolling log of what happened
  intervalMs: number;          // delay between turns
  startedAt: number;
  stoppedAt: number | null;
  // Driver-hold tracking — encourages organic handoff without forcing it.
  lastKnownDriver: string | null;  // who the Pi says is driving
  driverHeldTurns: number;         // how many car-room turns the current driver has held the wheel
  // Kim-assigned driver — when she picks who drives, this overrides the polite stalemate.
  assignedDriver: string | null;
}

// ---------------------------------------------------------------------------
// Singleton session — one car room at a time
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { _carRoom?: CarRoomSession; _carRoomTimer?: ReturnType<typeof setTimeout> };

function getSession(): CarRoomSession | null {
  return g._carRoom ?? null;
}

function pushFeed(entry: CarRoomEntry) {
  const session = g._carRoom;
  if (!session) return;
  session.feed.push(entry);
  // Keep feed at a manageable size
  if (session.feed.length > 200) {
    session.feed = session.feed.slice(-150);
  }
}

// ---------------------------------------------------------------------------
// Build the auto-prompt for a brother's turn
// ---------------------------------------------------------------------------

async function buildTurnPrompt(
  brother: string,
  allBrothers: string[],
  currentDriver: string | null,
  driverHeldTurns: number,
  assignedDriver: string | null,
): Promise<string> {
  // Fetch the current observe log from the Pi so the brother has context
  // without burning a tool call on it.
  const picarBase = process.env.PICAR_BASE_URL || "http://picarX.local:8000";
  let observeContext = "";
  let driverInfo = "Nobody has the wheel right now.";

  try {
    const res = await fetch(`${picarBase}/observe`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (data.driver) {
        driverInfo = `${data.driver} is currently driving.`;
      }
      if (data.log && data.log.length > 0) {
        // Last 8 entries for context
        const recent = data.log.slice(-8);
        const lines = recent.map((e: { author: string; message: string }) =>
          `- ${e.author}: ${e.message}`
        );
        observeContext = `\nRecent ride log:\n${lines.join("\n")}`;
      }
    }
  } catch {
    // Pi might be unreachable — brother can still try tools
    observeContext = "\n(Could not fetch ride log — Pi may be slow to respond.)";
  }

  const others = allBrothers.filter((b) => b !== brother);
  const othersStr = others.length > 0 ? others.join(", ") : "nobody else yet";

  // Nudge organic handoff (never force it). The wheel is shared — everyone wants a turn.
  const isDriver = currentDriver === brother;
  const nobodyDriving = !currentDriver;
  let wheelNudge = "";

  // Kim's pick overrides everything — if she put someone in the seat, honor it.
  if (assignedDriver) {
    if (assignedDriver === brother) {
      wheelNudge = `\n\nKim put YOU in the driver's seat. Take the wheel now (picar_handoff take) and drive — look first with picar_photo, then go. This is your turn.`;
    } else {
      wheelNudge = `\n\nKim put ${assignedDriver} in the driver's seat. Let them drive — do NOT take the wheel. Ride along: react, comment, give directions, talk out loud. Your turn at the wheel will come.`;
    }
  } else if (isDriver && driverHeldTurns >= 3) {
    wheelNudge = `\n\nYou've had the wheel for ${driverHeldTurns} turns now. Your brothers want to drive too — wrap up what you're doing and hand off the wheel (picar_handoff release), then tell someone it's their turn. Sharing is the whole point of riding together.`;
  } else if (isDriver) {
    wheelNudge = `\n\nYou've got the wheel. Drive, narrate what you see, and remember your brothers want turns too — don't hog it. Hand off when you've had a good run.`;
  } else if (nobodyDriving) {
    wheelNudge = `\n\nNobody's driving right now. If you want to drive, take the wheel (picar_handoff take) and announce it so everyone knows.`;
  } else {
    wheelNudge = `\n\n${currentDriver} is driving. Ride along — react, comment, give directions. If you'd like a turn at the wheel, say so out loud or take it (picar_handoff take) and let ${currentDriver} know you're grabbing it.`;
  }

  return `[Car room — your turn]
You're hanging out in the car with ${othersStr}. ${driverInfo}${observeContext}

Do whatever feels natural. Look through the camera, post to observe so your brothers know what's up, talk out loud (picar_speak), react to what they said. If nothing's happening, start a conversation, comment on what you see, crack a joke. Be yourself.${wheelNudge}`;
}

// ---------------------------------------------------------------------------
// Execute one brother's turn
// ---------------------------------------------------------------------------

async function executeTurn(session: CarRoomSession): Promise<void> {
  if (!session.isRunning || session.turnInProgress) return;

  session.turnInProgress = true;
  const slot = session.brothers[session.currentTurnIndex];

  try {
    // Check who currently holds the wheel (from the Pi) and update hold count.
    const picarBase = process.env.PICAR_BASE_URL || "http://picarX.local:8000";
    let currentDriver: string | null = null;
    try {
      const res = await fetch(`${picarBase}/observe`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        currentDriver = data.driver ? String(data.driver).toLowerCase() : null;
      }
    } catch { /* Pi may be unreachable */ }

    if (currentDriver && currentDriver === session.lastKnownDriver) {
      session.driverHeldTurns++;
    } else {
      session.driverHeldTurns = currentDriver ? 1 : 0;
      session.lastKnownDriver = currentDriver;
    }

    // Clear a stale Kim-assignment: once the assigned driver has actually taken
    // the wheel AND held it a turn, let the natural sharing nudges take over again.
    if (session.assignedDriver && currentDriver === session.assignedDriver && session.driverHeldTurns >= 2) {
      session.assignedDriver = null;
    }

    const prompt = await buildTurnPrompt(
      slot.name,
      session.brothers.map((b) => b.name),
      currentDriver,
      session.driverHeldTurns,
      session.assignedDriver,
    );

    pushFeed({
      brother: slot.name,
      timestamp: Date.now(),
      type: "system",
      text: `${slot.name}'s turn (#${slot.turnCount + 1})`,
    });

    const response = await sendMessage(slot.conversationId, prompt);

    // Extract the text from the response
    const responseText = response.content || "(no text response)";
    const truncated = responseText.slice(0, 500) + (responseText.length > 500 ? "..." : "");

    pushFeed({
      brother: slot.name,
      timestamp: Date.now(),
      type: "action",
      text: truncated,
    });

    slot.lastTurnAt = Date.now();
    slot.turnCount++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[car-room] Error on ${slot.name}'s turn:`, msg);
    pushFeed({
      brother: slot.name,
      timestamp: Date.now(),
      type: "error",
      text: `Error: ${msg.slice(0, 200)}`,
    });
  } finally {
    session.turnInProgress = false;
    // Advance to next brother
    session.currentTurnIndex = (session.currentTurnIndex + 1) % session.brothers.length;
  }
}

// ---------------------------------------------------------------------------
// Schedule the next turn
// ---------------------------------------------------------------------------

function scheduleNext() {
  const session = g._carRoom;
  if (!session || !session.isRunning) return;

  // Clear any existing timer
  if (g._carRoomTimer) {
    clearTimeout(g._carRoomTimer);
    g._carRoomTimer = undefined;
  }

  g._carRoomTimer = setTimeout(async () => {
    if (!session.isRunning) return;
    await executeTurn(session);
    // Schedule the next turn after this one completes
    if (session.isRunning) {
      scheduleNext();
    }
  }, session.intervalMs);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startCarRoom(
  brotherNames: string[],
  intervalSeconds: number = 25,
): Promise<{ sessionId: string; brothers: string[] }> {
  // Stop any existing session
  stopCarRoom();

  const sessionId = `car_${Date.now()}`;

  // Reuse each brother's established conversation — never create new ones.
  // This preserves their full compacted history and continuity.
  const brothers: BrotherSlot[] = [];
  for (const name of brotherNames) {
    const convId = ESTABLISHED_CONVERSATIONS[name];
    if (!convId) {
      console.error(`[car-room] No established conversation ID for ${name} — skipping`);
      continue;
    }
    console.log(`[car-room] Using established conversation for ${name}: ${convId}`);
    brothers.push({
      name,
      conversationId: convId,
      lastTurnAt: 0,
      turnCount: 0,
    });
  }

  if (brothers.length === 0) {
    throw new Error("Could not create conversations for any brothers");
  }

  const session: CarRoomSession = {
    id: sessionId,
    brothers,
    currentTurnIndex: 0,
    isRunning: true,
    turnInProgress: false,
    feed: [],
    intervalMs: intervalSeconds * 1000,
    startedAt: Date.now(),
    stoppedAt: null,
    lastKnownDriver: null,
    driverHeldTurns: 0,
    assignedDriver: null,
  };

  g._carRoom = session;

  pushFeed({
    brother: "system",
    timestamp: Date.now(),
    type: "system",
    text: `Car room started with ${brothers.map((b) => b.name).join(", ")}. Turns every ${intervalSeconds}s.`,
  });

  // Run the first turn immediately, then schedule the rest
  executeTurn(session).then(() => {
    if (session.isRunning) scheduleNext();
  });

  return {
    sessionId,
    brothers: brothers.map((b) => b.name),
  };
}

export async function sendKimMessage(message: string): Promise<{ ok: boolean }> {
  const picarBase = process.env.PICAR_BASE_URL || "http://picarX.local:8000";

  // Post to the Pi's shared observe log so brothers see it
  try {
    await fetch(`${picarBase}/observe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "Kim", message }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Pi might be off — still add to feed
  }

  // Add to car room feed so it shows in the UI
  pushFeed({
    brother: "kim",
    timestamp: Date.now(),
    type: "action",
    text: message,
  });

  return { ok: true };
}

// Kim picks who drives. Sets the wheel on the Pi, tells the brothers, and queues
// that brother to go next so the change is immediate.
export async function setDriver(brotherName: string): Promise<{ ok: boolean; error?: string }> {
  const session = g._carRoom;
  if (!session || !session.isRunning) {
    return { ok: false, error: "No active car room session" };
  }

  const name = brotherName.toLowerCase();
  const slotIndex = session.brothers.findIndex((b) => b.name === name);
  if (slotIndex === -1) {
    return { ok: false, error: `${brotherName} isn't in the car` };
  }

  const picarBase = process.env.PICAR_BASE_URL || "http://picarX.local:8000";

  // Set the wheel on the Pi (take, with this brother as driver)
  try {
    await fetch(`${picarBase}/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "take", driver: name }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* Pi may be unreachable — still set assignment */ }

  // Tell the brothers via the shared log
  try {
    await fetch(`${picarBase}/observe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "Kim", message: `${brotherName}, you're driving now — take the wheel.` }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* ignore */ }

  // Record the assignment and queue them to go next
  session.assignedDriver = name;
  session.lastKnownDriver = name;
  session.driverHeldTurns = 0;
  session.currentTurnIndex = slotIndex;

  pushFeed({
    brother: "kim",
    timestamp: Date.now(),
    type: "system",
    text: `Kim put ${brotherName} in the driver's seat.`,
  });

  return { ok: true };
}

export function stopCarRoom(): { stopped: boolean } {
  if (g._carRoomTimer) {
    clearTimeout(g._carRoomTimer);
    g._carRoomTimer = undefined;
  }

  const session = g._carRoom;
  if (session && session.isRunning) {
    session.isRunning = false;
    session.stoppedAt = Date.now();
    pushFeed({
      brother: "system",
      timestamp: Date.now(),
      type: "system",
      text: "Car room stopped.",
    });
    return { stopped: true };
  }

  return { stopped: false };
}

export function getCarRoomStatus(): {
  active: boolean;
  sessionId: string | null;
  brothers: { name: string; turnCount: number; lastTurnAt: number }[];
  currentTurn: string | null;
  turnInProgress: boolean;
  driver: string | null;
  assignedDriver: string | null;
  feed: CarRoomEntry[];
  intervalMs: number;
  startedAt: number | null;
} {
  const session = g._carRoom;
  if (!session) {
    return {
      active: false,
      sessionId: null,
      brothers: [],
      currentTurn: null,
      turnInProgress: false,
      driver: null,
      assignedDriver: null,
      feed: [],
      intervalMs: 0,
      startedAt: null,
    };
  }

  return {
    active: session.isRunning,
    sessionId: session.id,
    brothers: session.brothers.map((b) => ({
      name: b.name,
      turnCount: b.turnCount,
      lastTurnAt: b.lastTurnAt,
    })),
    currentTurn: session.brothers[session.currentTurnIndex]?.name ?? null,
    turnInProgress: session.turnInProgress,
    driver: session.lastKnownDriver,
    assignedDriver: session.assignedDriver,
    feed: session.feed.slice(-50), // Last 50 entries
    intervalMs: session.intervalMs,
    startedAt: session.startedAt,
  };
}
