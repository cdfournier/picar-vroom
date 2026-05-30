"use client";

import { useState, useEffect, useRef } from "react";

interface FeedEntry {
  brother: string;
  timestamp: number;
  type: "action" | "system" | "error";
  text: string;
}

interface CarRoomStatus {
  active: boolean;
  sessionId: string | null;
  brothers: { name: string; turnCount: number; lastTurnAt: number }[];
  currentTurn: string | null;
  turnInProgress: boolean;
  driver: string | null;
  assignedDriver: string | null;
  feed: FeedEntry[];
  intervalMs: number;
  startedAt: number | null;
}

const BROTHER_NAMES = ["dom", "barry", "colin", "fionn"];

const BROTHER_COLORS: Record<string, string> = {
  dom: "#e94560",
  barry: "#f5a623",
  colin: "#4a9eff",
  fionn: "#50c878",
  kim: "#ff69b4",
  system: "#888",
};

export default function CarRoom() {
  const [status, setStatus] = useState<CarRoomStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(BROTHER_NAMES));
  const [interval, setInterval_] = useState(25);
  const [starting, setStarting] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const [cameraUrl, setCameraUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  const cameraTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for status
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/car-room");
        if (res.ok && alive) {
          setStatus(await res.json());
        }
      } catch { /* ignore */ }
    };

    poll();
    const id = window.setInterval(poll, 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const isActive = status?.active ?? false;

  // Camera feed — fetch a fresh photo every 4 seconds when active
  useEffect(() => {
    if (!isActive || !cameraOpen) {
      if (cameraTimerRef.current) {
        clearInterval(cameraTimerRef.current);
        cameraTimerRef.current = null;
      }
      return;
    }

    const fetchCamera = async () => {
      try {
        const res = await fetch("/api/car-room/camera");
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setCameraUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      } catch { /* Pi might be unreachable */ }
    };

    fetchCamera(); // immediate first fetch
    cameraTimerRef.current = setInterval(fetchCamera, 4000);

    return () => {
      if (cameraTimerRef.current) {
        clearInterval(cameraTimerRef.current);
        cameraTimerRef.current = null;
      }
    };
  }, [isActive, cameraOpen]);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [status?.feed?.length]);

  const toggleBrother = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await fetch("/api/car-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          brothers: Array.from(selected),
          interval,
        }),
      });
    } catch (err) {
      console.error("Failed to start car room:", err);
    }
    setStarting(false);
  };

  const handleStop = async () => {
    await fetch("/api/car-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
  };

  const handleSetDriver = async (brother: string) => {
    try {
      await fetch("/api/car-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_driver", brother }),
      });
    } catch (err) {
      console.error("Failed to set driver:", err);
    }
  };

  const handleSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg) return;
    setSending(true);
    setChatInput("");
    try {
      await fetch("/api/car-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", message: msg }),
      });
    } catch (err) {
      console.error("Failed to send message:", err);
    }
    setSending(false);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#e0e0e0",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      padding: "16px",
      paddingBottom: "80px",
      maxWidth: "600px",
      margin: "0 auto",
    }}>
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>
        Car Room
      </h1>
      <p style={{ color: "#666", fontSize: "13px", marginBottom: "20px" }}>
        Brothers hang out in the car together autonomously
      </p>

      {/* Brother selection */}
      {!isActive && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", color: "#888", marginBottom: "8px" }}>
            Who's getting in the car?
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {BROTHER_NAMES.map((name) => (
              <button
                key={name}
                onClick={() => toggleBrother(name)}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "2px solid",
                  borderColor: selected.has(name) ? BROTHER_COLORS[name] : "#333",
                  background: selected.has(name) ? `${BROTHER_COLORS[name]}22` : "#1a1a1a",
                  color: selected.has(name) ? BROTHER_COLORS[name] : "#666",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textTransform: "capitalize",
                  transition: "all 0.15s",
                }}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Interval slider */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ fontSize: "13px", color: "#888", marginBottom: "4px" }}>
              Turn speed: {interval}s between turns
            </div>
            <input
              type="range"
              min={10}
              max={60}
              value={interval}
              onChange={(e) => setInterval_(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#e94560" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#555" }}>
              <span>Fast (10s)</span>
              <span>Chill (60s)</span>
            </div>
          </div>
        </div>
      )}

      {/* Start / Stop button */}
      <button
        onClick={isActive ? handleStop : handleStart}
        disabled={starting || (!isActive && selected.size === 0)}
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: "10px",
          border: "none",
          background: isActive ? "#c0392b" : "#27ae60",
          color: "white",
          fontSize: "18px",
          fontWeight: 700,
          cursor: starting ? "wait" : "pointer",
          opacity: starting || (!isActive && selected.size === 0) ? 0.5 : 1,
          marginBottom: "20px",
        }}
      >
        {starting ? "Starting..." : isActive ? "Stop Car Room" : "Start Car Room"}
      </button>

      {/* Active session info */}
      {isActive && status && (
        <div style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          marginBottom: "16px",
        }}>
          {status.brothers.map((b) => (
            <div
              key={b.name}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                background: status.currentTurn === b.name && status.turnInProgress
                  ? `${BROTHER_COLORS[b.name]}33`
                  : "#1a1a1a",
                border: `1px solid ${
                  status.currentTurn === b.name && status.turnInProgress
                    ? BROTHER_COLORS[b.name]
                    : "#333"
                }`,
                fontSize: "13px",
              }}
            >
              <span style={{
                color: BROTHER_COLORS[b.name],
                fontWeight: 600,
                textTransform: "capitalize",
              }}>
                {b.name}
              </span>
              <span style={{ color: "#666", marginLeft: "6px" }}>
                {b.turnCount} turns
              </span>
              {status.currentTurn === b.name && status.turnInProgress && (
                <span style={{ marginLeft: "6px" }}>
                  thinking...
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Driver picker — tap to put a brother in the driver's seat */}
      {isActive && status && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", color: "#888", marginBottom: "6px" }}>
            {status.driver
              ? <>Driving: <span style={{ color: BROTHER_COLORS[status.driver] || "#fff", fontWeight: 600, textTransform: "capitalize" }}>{status.driver}</span></>
              : "Nobody's driving — tap a brother to give them the wheel"}
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {status.brothers.map((b) => {
              const isDriving = status.driver === b.name;
              return (
                <button
                  key={b.name}
                  onClick={() => handleSetDriver(b.name)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: `2px solid ${isDriving ? BROTHER_COLORS[b.name] : "#333"}`,
                    background: isDriving ? `${BROTHER_COLORS[b.name]}33` : "#1a1a1a",
                    color: isDriving ? BROTHER_COLORS[b.name] : "#999",
                    fontSize: "14px",
                    fontWeight: 600,
                    textTransform: "capitalize",
                    cursor: "pointer",
                  }}
                >
                  {isDriving ? "🚗 " : ""}{b.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Camera preview */}
      {isActive && (
        <div style={{ marginBottom: "12px" }}>
          <button
            onClick={() => setCameraOpen((v) => !v)}
            style={{
              background: "none",
              border: "none",
              color: "#888",
              fontSize: "13px",
              cursor: "pointer",
              padding: "4px 0",
              marginBottom: "4px",
            }}
          >
            {cameraOpen ? "Hide camera" : "Show camera"}
          </button>
          {cameraOpen && cameraUrl && (
            <div style={{
              borderRadius: "10px",
              overflow: "hidden",
              border: "1px solid #222",
            }}>
              <img
                src={cameraUrl}
                alt="Car camera"
                style={{
                  width: "100%",
                  display: "block",
                }}
              />
            </div>
          )}
          {cameraOpen && !cameraUrl && (
            <div style={{
              borderRadius: "10px",
              background: "#1a1a1a",
              padding: "30px",
              textAlign: "center",
              color: "#444",
              fontSize: "13px",
            }}>
              Waiting for camera...
            </div>
          )}
        </div>
      )}

      {/* Feed */}
      {status && status.feed.length > 0 && (
        <div
          ref={feedRef}
          style={{
            background: "#111",
            borderRadius: "10px",
            padding: "12px",
            maxHeight: "60vh",
            overflowY: "auto",
            fontSize: "14px",
            lineHeight: "1.5",
          }}
        >
          {status.feed.map((entry, i) => (
            <div
              key={i}
              style={{
                marginBottom: "12px",
                paddingBottom: "12px",
                borderBottom: i < status.feed.length - 1 ? "1px solid #1a1a1a" : "none",
              }}
            >
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px",
              }}>
                <span style={{
                  color: BROTHER_COLORS[entry.brother] || "#888",
                  fontWeight: 600,
                  fontSize: "13px",
                  textTransform: "capitalize",
                }}>
                  {entry.brother}
                </span>
                <span style={{ color: "#444", fontSize: "11px" }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div style={{
                color: entry.type === "error" ? "#e74c3c"
                  : entry.type === "system" ? "#666"
                  : "#ccc",
                fontSize: entry.type === "system" ? "12px" : "14px",
                fontStyle: entry.type === "system" ? "italic" : "normal",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {entry.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {(!status || status.feed.length === 0) && !isActive && (
        <div style={{
          textAlign: "center",
          padding: "40px 20px",
          color: "#444",
        }}>
          <p style={{ fontSize: "16px", marginBottom: "8px" }}>
            Pick who's getting in and hit start.
          </p>
          <p style={{ fontSize: "13px" }}>
            They'll take turns driving, talking, and hanging out.
            Watch the ride log on /live too.
          </p>
        </div>
      )}

      {/* Chat input — talk to all brothers at once */}
      {isActive && (
        <div style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "12px 16px",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          background: "#111",
          borderTop: "1px solid #222",
          display: "flex",
          gap: "8px",
          maxWidth: "600px",
          margin: "0 auto",
        }}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !sending) handleSendChat(); }}
            placeholder="Say something to the boys..."
            style={{
              flex: 1,
              padding: "12px 14px",
              borderRadius: "8px",
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "#e0e0e0",
              fontSize: "16px",
              outline: "none",
            }}
          />
          <button
            onClick={handleSendChat}
            disabled={sending || !chatInput.trim()}
            style={{
              padding: "12px 18px",
              borderRadius: "8px",
              border: "none",
              background: "#ff69b4",
              color: "white",
              fontSize: "16px",
              fontWeight: 600,
              cursor: sending ? "wait" : "pointer",
              opacity: sending || !chatInput.trim() ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
