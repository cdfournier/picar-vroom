import { NextResponse } from "next/server";

// Proxy the Pi camera so the phone doesn't need to reach picarX.local directly
const PICAR_BASE_URL = process.env.PICAR_BASE_URL || "http://picarX.local:8000";

export async function GET() {
  try {
    // /camera returns raw JPEG bytes (/photo returns JSON with base64 — wrong format here)
    const res = await fetch(`${PICAR_BASE_URL}/camera`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Camera unavailable" }, { status: 502 });
    }

    const imageData = await res.arrayBuffer();

    return new NextResponse(imageData, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Pi unreachable" }, { status: 502 });
  }
}
