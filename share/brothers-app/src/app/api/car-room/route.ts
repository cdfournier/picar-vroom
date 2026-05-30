import { NextRequest, NextResponse } from "next/server";
import { startCarRoom, stopCarRoom, getCarRoomStatus, sendKimMessage, setDriver } from "@/lib/car-room";

// GET /api/car-room — get current car room status + feed
export async function GET() {
  const status = getCarRoomStatus();
  return NextResponse.json(status);
}

// POST /api/car-room — start or stop a car room session
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body as { action: string };

  if (action === "start") {
    const { brothers, interval } = body as {
      brothers?: string[];
      interval?: number;
    };

    if (!brothers || brothers.length === 0) {
      return NextResponse.json(
        { error: "Provide at least one brother name in 'brothers' array" },
        { status: 400 }
      );
    }

    try {
      const result = await startCarRoom(brothers, interval || 25);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "stop") {
    const result = stopCarRoom();
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "message") {
    const { message } = body as { message?: string };
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }
    const result = await sendKimMessage(message);
    return NextResponse.json(result);
  }

  if (action === "set_driver") {
    const { brother } = body as { brother?: string };
    if (!brother) {
      return NextResponse.json({ error: "brother required" }, { status: 400 });
    }
    const result = await setDriver(brother);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json(
    { error: "action must be 'start', 'stop', 'message', or 'set_driver'" },
    { status: 400 }
  );
}
