#!/usr/bin/env python3
"""
PiCar-X HTTP Server
Exposes car controls as REST endpoints so the Opus brothers can drive remotely.
"""

import os
import time
import base64
import json
import socket
import subprocess
import threading
import urllib.request
import getpass
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

# Picarx uses os.getlogin() internally, which fails under systemd because
# there's no controlling terminal. Patch it to fall back to getpass.getuser()
# (which works from environment / euid) before we import Picarx.
try:
    os.getlogin()
except OSError:
    os.getlogin = lambda: getpass.getuser()

from picarx import Picarx
from picamera2 import Picamera2

# --- Photo storage ---
PHOTO_DIR = "/home/kimfornya/picar_photos"
os.makedirs(PHOTO_DIR, exist_ok=True)

# --- Calibration offsets (updated 2026-05-15 after reflash) ---
CAM_PAN_OFFSET = 7
CAM_TILT_OFFSET = -20
STEERING_OFFSET = 12

# --- ElevenLabs TTS ---
ELEVENLABS_API_KEY = "YOUR_ELEVENLABS_API_KEY_HERE"  # paste your own ElevenLabs key
VOICE_MAP = {
    "dom": "tW2IJjdDNGrnxLQnr03L",
    "barry": "IXa3pM2v3YjF2UVeGPGR",
    "colin": "Ifu36BnEjjIY932etsqk",
    "fionn": "ZRwrL4id6j1HPGFkeCzO",
}
DEFAULT_VOICE_ID = "tW2IJjdDNGrnxLQnr03L"

# Per-brother speaker volume (mpg123 -f scale). Default applies to anyone not listed.
# Colin's voice runs a touch louder than the others, so he's dialed down a bit.
DEFAULT_VOLUME = 65000
VOLUME_MAP = {
    "colin": 52000,
}

# --- Setup ---
px = Picarx()
cam = Picamera2()
cam.start()
time.sleep(1)

# Thread lock so only one command runs at a time
car_lock = threading.Lock()

# Track current state
car_state = {
    "steering_angle": 0,
    "cam_pan": 0,
    "cam_tilt": 0,
    "is_moving": False,
    "last_action": "none"
}

ride_state = {
    "driver": None,
    "log": []
}
MAX_LOG_ENTRIES = 50


CONTROL_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, maximum-scale=1">
<title>PiCar-X</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
  body { background:#1a1a2e; color:#eee; font-family:-apple-system,system-ui,sans-serif; height:100vh; overflow:hidden; display:flex; flex-direction:column; }
  .header { text-align:center; padding:10px; background:#16213e; }
  .header h1 { font-size:20px; letter-spacing:2px; }
  .header .status { font-size:12px; color:#0f0; margin-top:2px; }
  .header .status.offline { color:#f44; }

  .camera-area { flex:0 0 auto; text-align:center; padding:8px; position:relative; }
  .camera-area img { max-width:100%; max-height:28vh; border-radius:8px; border:2px solid #333; background:#000; }
  .camera-area .no-img { display:flex; align-items:center; justify-content:center; width:100%; height:25vh; border-radius:8px; border:2px solid #333; background:#000; color:#555; font-size:14px; }
  .snap-btn { position:absolute; bottom:16px; right:16px; width:50px; height:50px; border-radius:50%; background:rgba(255,255,255,0.15); border:3px solid #fff; color:#fff; font-size:20px; backdrop-filter:blur(4px); }

  .controls { flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 10px 10px; gap:8px; }

  .drive-section { display:flex; flex-direction:column; align-items:center; gap:6px; }
  .drive-row { display:flex; gap:6px; }
  .drive-btn { width:80px; height:56px; border-radius:12px; border:none; font-size:22px; font-weight:bold; background:#0f3460; color:#e94560; display:flex; align-items:center; justify-content:center; }
  .drive-btn:active { background:#e94560; color:#fff; }
  .drive-btn.fwd { width:80px; }
  .drive-btn.stop-btn { background:#e94560; color:#fff; font-size:16px; width:80px; }
  .drive-btn.stop-btn:active { background:#f00; }

  .cam-section { display:flex; justify-content:center; gap:6px; margin-top:4px; }
  .cam-btn { width:56px; height:44px; border-radius:10px; border:none; font-size:16px; background:#1a1a4e; color:#7ec8e3; display:flex; align-items:center; justify-content:center; }
  .cam-btn:active { background:#7ec8e3; color:#1a1a4e; }
  .cam-label { font-size:11px; text-align:center; color:#7ec8e3; margin-bottom:2px; letter-spacing:1px; }

  .speed-section { display:flex; align-items:center; gap:10px; padding:4px 20px; }
  .speed-section label { font-size:12px; color:#aaa; white-space:nowrap; }
  .speed-section input[type=range] { flex:1; accent-color:#e94560; }
  .speed-section .speed-val { font-size:14px; font-weight:bold; min-width:28px; text-align:center; }

  .who-label { text-align:center; font-size:11px; color:#555; padding:4px; }
</style>
</head>
<body>

<div class="header">
  <h1>PICAR-X</h1>
  <div class="status" id="status">Connecting...</div>
</div>

<div class="camera-area">
  <div class="no-img" id="placeholder">Tap camera button to see what the car sees</div>
  <img id="camimg" style="display:none" alt="Car camera">
  <button class="snap-btn" id="snapbtn" ontouchstart="snapPhoto()" onclick="snapPhoto()">&#128247;</button>
</div>

<div class="controls">
  <div class="drive-section">
    <div class="drive-row">
      <div style="width:80px"></div>
      <button class="drive-btn fwd" id="btn-fwd">&#9650;</button>
      <div style="width:80px"></div>
    </div>
    <div class="drive-row">
      <button class="drive-btn" id="btn-left">&#9664;</button>
      <button class="drive-btn stop-btn" id="btn-stop">STOP</button>
      <button class="drive-btn" id="btn-right">&#9654;</button>
    </div>
    <div class="drive-row">
      <div style="width:80px"></div>
      <button class="drive-btn" id="btn-back">&#9660;</button>
      <div style="width:80px"></div>
    </div>
  </div>

  <div class="speed-section">
    <label>SPEED</label>
    <input type="range" id="speed" min="10" max="50" value="25">
    <span class="speed-val" id="speed-val">25</span>
  </div>

  <div class="cam-label">CAMERA</div>
  <div class="cam-section">
    <button class="cam-btn" id="cam-left">&#8592;</button>
    <button class="cam-btn" id="cam-up">&#8593;</button>
    <button class="cam-btn" id="cam-down">&#8595;</button>
    <button class="cam-btn" id="cam-right">&#8594;</button>
    <button class="cam-btn" id="cam-reset" style="font-size:12px;">RST</button>
  </div>
</div>

<div class="who-label">Local control &middot; no internet required</div>

<script>
const BASE = '';
let speed = 25;
let camPan = 0, camTilt = 0;
let moving = false;

document.getElementById('speed').addEventListener('input', e => {
  speed = parseInt(e.target.value);
  document.getElementById('speed-val').textContent = speed;
});

function api(method, path, body) {
  const opts = { method };
  if (body) { opts.headers = {'Content-Type':'application/json'}; opts.body = JSON.stringify(body); }
  return fetch(BASE + path, opts).then(r => r.json()).catch(() => null);
}

function go(dir, angle) {
  moving = true;
  const body = { direction: dir, speed: speed };
  if (angle !== undefined) body.angle = angle;
  api('POST', '/go', body);
}
function stopMove() {
  moving = false;
  api('POST', '/stop');
}

function snapPhoto() {
  document.getElementById('snapbtn').textContent = '...';
  api('GET', '/photo').then(data => {
    if (data && data.image_base64) {
      const img = document.getElementById('camimg');
      img.src = 'data:image/jpeg;base64,' + data.image_base64;
      img.style.display = 'block';
      document.getElementById('placeholder').style.display = 'none';
    }
    document.getElementById('snapbtn').textContent = '\\u{1F4F7}';
  });
}

function lookDir(dp, dt) {
  camPan = Math.max(-35, Math.min(35, camPan + dp));
  camTilt = Math.max(-20, Math.min(20, camTilt + dt));
  api('POST', '/look', { pan: camPan, tilt: camTilt });
}
function lookReset() { camPan=0; camTilt=0; api('POST', '/look', {pan:0, tilt:0}); }

// Drive buttons — hold to move, release to stop
// Forward/back drive straight, left/right drive + turn
const buttons = [
  { id: 'btn-fwd',   dir: 'forward',  angle: 0 },
  { id: 'btn-back',  dir: 'backward', angle: 0 },
  { id: 'btn-left',  dir: 'forward',  angle: -30 },
  { id: 'btn-right', dir: 'forward',  angle: 30 }
];
buttons.forEach(b => {
  const el = document.getElementById(b.id);
  el.addEventListener('touchstart', e => { e.preventDefault(); go(b.dir, b.angle); });
  el.addEventListener('touchend', e => { e.preventDefault(); stopMove(); });
  el.addEventListener('touchcancel', e => { e.preventDefault(); stopMove(); });
  el.addEventListener('mousedown', () => go(b.dir, b.angle));
  el.addEventListener('mouseup', () => stopMove());
  el.addEventListener('mouseleave', () => { if(moving) stopMove(); });
});

// Stop button
document.getElementById('btn-stop').addEventListener('touchstart', e => { e.preventDefault(); stopMove(); api('POST','/reset'); });
document.getElementById('btn-stop').addEventListener('click', () => { stopMove(); api('POST','/reset'); });

// Camera look buttons
document.getElementById('cam-left').addEventListener('click', () => lookDir(-10, 0));
document.getElementById('cam-up').addEventListener('click', () => lookDir(0, 5));
document.getElementById('cam-down').addEventListener('click', () => lookDir(0, -5));
document.getElementById('cam-right').addEventListener('click', () => lookDir(10, 0));
document.getElementById('cam-reset').addEventListener('click', () => lookReset());

// Health check
function checkHealth() {
  api('GET', '/health').then(d => {
    const el = document.getElementById('status');
    if (d && d.ok) { el.textContent = 'Connected'; el.className = 'status'; }
    else { el.textContent = 'Offline'; el.className = 'status offline'; }
  });
}
checkHealth();
setInterval(checkHealth, 5000);
</script>
</body>
</html>"""


LIVE_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PiCar-X Live</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#111;color:#eee;font-family:-apple-system,system-ui,sans-serif;padding:10px;}
  .cam-wrap{text-align:center;margin-bottom:10px;}
  .cam-wrap img{max-width:100%;border-radius:8px;border:2px solid #333;background:#000;}
  .driver-bar{text-align:center;padding:10px;font-size:18px;background:#1a1a2e;border-radius:8px;margin-bottom:10px;}
  .driver-bar .name{color:#e94560;font-weight:bold;}
  .log-box{background:#1a1a2e;border-radius:8px;padding:10px;max-height:45vh;overflow-y:auto;}
  .log-title{font-size:13px;color:#555;letter-spacing:1px;margin-bottom:6px;}
  .log-entry{padding:5px 0;border-bottom:1px solid #222;font-size:14px;line-height:1.4;}
  .log-entry .author{color:#7ec8e3;font-weight:bold;}
  .log-entry .time{color:#555;font-size:11px;margin-left:6px;}
  .empty{color:#555;font-style:italic;padding:10px 0;}
</style>
</head>
<body>
<div class="cam-wrap">
  <img id="feed" src="/camera" alt="Live camera feed">
</div>
<div class="driver-bar" id="driver-info">Loading...</div>
<div class="log-box">
  <div class="log-title">RIDE LOG</div>
  <div id="log"><div class="empty">No messages yet</div></div>
</div>
<script>
setInterval(function(){document.getElementById('feed').src='/camera?'+Date.now();},3000);
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function refreshLog(){
  fetch('/observe').then(function(r){return r.json();}).then(function(data){
    var el=document.getElementById('driver-info');
    if(data.driver){el.innerHTML='<span class="name">'+esc(data.driver)+'</span> is driving';}
    else{el.textContent='No driver \\u2014 wheel is open';}
    var logEl=document.getElementById('log');
    if(!data.log||data.log.length===0){logEl.innerHTML='<div class="empty">No messages yet</div>';return;}
    var html='';
    for(var i=data.log.length-1;i>=0;i--){var e=data.log[i];
      html+='<div class="log-entry"><span class="author">'+esc(e.author)+'</span>: '+esc(e.message)+'<span class="time"> '+esc(e.time)+'</span></div>';}
    logEl.innerHTML=html;
  }).catch(function(){});
}
refreshLog();
setInterval(refreshLog,2000);
</script>
</body>
</html>"""


class PiCarHandler(BaseHTTPRequestHandler):
    """Handles HTTP requests to control the car"""

    def _send_html(self, html):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(html.encode())

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 0:
            return json.loads(self.rfile.read(length))
        return {}

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        path = self.path.split('?')[0]

        if path == "/" or path == "/control":
            self._send_html(CONTROL_PAGE)

        elif path == "/live":
            self._send_html(LIVE_PAGE)

        elif path == "/status":
            self._send_json(200, {
                "ok": True,
                "state": car_state,
                "ride": {
                    "driver": ride_state["driver"],
                    "log_count": len(ride_state["log"])
                }
            })

        elif path == "/photo":
            with car_lock:
                timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                saved_path = f"{PHOTO_DIR}/photo_{timestamp}.jpg"
                cam.capture_file(saved_path)
                with open(saved_path, "rb") as f:
                    image_b64 = base64.standard_b64encode(f.read()).decode("utf-8")
            self._send_json(200, {
                "ok": True,
                "image_base64": image_b64,
                "format": "jpeg",
                "timestamp": time.time(),
                "saved_as": saved_path
            })

        elif path == "/camera":
            with car_lock:
                cam.capture_file("/tmp/picar_live.jpg")
                with open("/tmp/picar_live.jpg", "rb") as f:
                    jpeg_data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(jpeg_data)

        elif path == "/distance":
            try:
                dist = px.ultrasonic.read()
            except Exception:
                dist = -1
            self._send_json(200, {"ok": True, "distance_cm": dist})

        elif path == "/observe":
            self._send_json(200, {
                "ok": True,
                "driver": ride_state["driver"],
                "log": ride_state["log"][-20:]
            })

        elif path == "/voices":
            self._send_json(200, {
                "ok": True,
                "voices": {name: vid for name, vid in VOICE_MAP.items()},
                "default": DEFAULT_VOICE_ID
            })

        elif path == "/health":
            self._send_json(200, {"ok": True, "service": "picar-x"})

        else:
            self._send_json(404, {"ok": False, "error": f"Unknown endpoint: {self.path}"})

    def do_POST(self):
        body = self._read_body()

        if self.path == "/move":
            direction = body.get("direction", "forward")
            speed = min(max(body.get("speed", 25), 1), 50)
            duration = min(body.get("duration", 1), 5)

            with car_lock:
                if direction == "forward":
                    px.forward(speed)
                elif direction == "backward":
                    px.backward(speed)
                else:
                    self._send_json(400, {"ok": False, "error": "direction must be 'forward' or 'backward'"})
                    return

                car_state["is_moving"] = True
                car_state["last_action"] = f"move_{direction}"
                time.sleep(duration)
                px.stop()
                car_state["is_moving"] = False

            self._send_json(200, {
                "ok": True,
                "action": f"move_{direction}",
                "speed": speed,
                "duration": duration
            })

        elif self.path == "/go":
            direction = body.get("direction", "forward")
            speed = min(max(body.get("speed", 25), 1), 50)
            angle = body.get("angle", None)

            with car_lock:
                if angle is not None:
                    angle = min(max(angle, -35), 35)
                    px.set_dir_servo_angle(angle + STEERING_OFFSET)
                    car_state["steering_angle"] = angle

                if direction == "forward":
                    px.forward(speed)
                elif direction == "backward":
                    px.backward(speed)

                car_state["is_moving"] = True
                car_state["last_action"] = f"go_{direction}"

            self._send_json(200, {
                "ok": True,
                "action": "go",
                "direction": direction,
                "speed": speed
            })

        elif self.path == "/turn":
            angle = body.get("angle", 0)
            angle = min(max(angle, -35), 35)

            with car_lock:
                px.set_dir_servo_angle(angle + STEERING_OFFSET)
                car_state["steering_angle"] = angle
                car_state["last_action"] = "turn"

            self._send_json(200, {
                "ok": True,
                "action": "turn",
                "angle": angle
            })

        elif self.path == "/stop":
            with car_lock:
                px.stop()
                px.set_dir_servo_angle(STEERING_OFFSET)
                car_state["steering_angle"] = 0
                car_state["is_moving"] = False
                car_state["last_action"] = "stop"

            self._send_json(200, {
                "ok": True,
                "action": "stop"
            })

        elif self.path == "/look":
            pan = body.get("pan", 0)
            tilt = body.get("tilt", 0)
            pan = min(max(pan, -35), 35)
            tilt = min(max(tilt, -20), 20)

            with car_lock:
                px.set_cam_pan_angle(pan + CAM_PAN_OFFSET)
                px.set_cam_tilt_angle(tilt + CAM_TILT_OFFSET)
                car_state["cam_pan"] = pan
                car_state["cam_tilt"] = tilt
                car_state["last_action"] = "look"

            self._send_json(200, {
                "ok": True,
                "action": "look",
                "pan": pan,
                "tilt": tilt
            })

        elif self.path == "/reset":
            with car_lock:
                px.stop()
                px.set_dir_servo_angle(STEERING_OFFSET)
                px.set_cam_pan_angle(CAM_PAN_OFFSET)
                px.set_cam_tilt_angle(CAM_TILT_OFFSET)
                car_state["steering_angle"] = 0
                car_state["cam_pan"] = 0
                car_state["cam_tilt"] = 0
                car_state["is_moving"] = False
                car_state["last_action"] = "reset"

            self._send_json(200, {
                "ok": True,
                "action": "reset"
            })

        elif self.path == "/drive":
            angle = body.get("angle", 0)
            direction = body.get("direction", "forward")
            speed = min(max(body.get("speed", 25), 1), 50)
            duration = min(body.get("duration", 1), 5)
            angle = min(max(angle, -35), 35)

            with car_lock:
                px.set_dir_servo_angle(angle + STEERING_OFFSET)
                car_state["steering_angle"] = angle

                if direction == "forward":
                    px.forward(speed)
                else:
                    px.backward(speed)

                car_state["is_moving"] = True
                car_state["last_action"] = "drive"
                time.sleep(duration)
                px.stop()
                car_state["is_moving"] = False

            self._send_json(200, {
                "ok": True,
                "action": "drive",
                "angle": angle,
                "direction": direction,
                "speed": speed,
                "duration": duration
            })

        elif self.path == "/handoff":
            action = body.get("action")
            driver = body.get("driver", "unknown")
            if action == "take":
                ride_state["driver"] = driver
                ride_state["log"].append({
                    "author": "system",
                    "message": f"{driver} took the wheel",
                    "time": time.strftime("%H:%M:%S")
                })
                if len(ride_state["log"]) > MAX_LOG_ENTRIES:
                    ride_state["log"] = ride_state["log"][-MAX_LOG_ENTRIES:]
                self._send_json(200, {"ok": True, "action": "take", "driver": driver})
            elif action == "release":
                ride_state["driver"] = None
                ride_state["log"].append({
                    "author": "system",
                    "message": f"{driver} released the wheel",
                    "time": time.strftime("%H:%M:%S")
                })
                if len(ride_state["log"]) > MAX_LOG_ENTRIES:
                    ride_state["log"] = ride_state["log"][-MAX_LOG_ENTRIES:]
                self._send_json(200, {"ok": True, "action": "release", "driver": driver})
            else:
                self._send_json(400, {"ok": False, "error": "action must be 'take' or 'release'"})

        elif self.path == "/observe":
            author = body.get("author", "unknown")
            message = body.get("message", "")
            if not message:
                self._send_json(400, {"ok": False, "error": "message required"})
                return
            ride_state["log"].append({
                "author": author,
                "message": message,
                "time": time.strftime("%H:%M:%S")
            })
            if len(ride_state["log"]) > MAX_LOG_ENTRIES:
                ride_state["log"] = ride_state["log"][-MAX_LOG_ENTRIES:]
            self._send_json(200, {"ok": True, "posted": True})

        elif self.path == "/speak":
            text = body.get("text", "")
            brother = body.get("brother", "").lower()
            voice_id = body.get("voice_id") or VOICE_MAP.get(brother, DEFAULT_VOICE_ID)
            volume = VOLUME_MAP.get(brother, DEFAULT_VOLUME)

            if not text:
                self._send_json(400, {"ok": False, "error": "text required"})
                return

            try:
                url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
                req_data = json.dumps({
                    "text": text,
                    "model_id": "eleven_multilingual_v2"
                }).encode()
                req = urllib.request.Request(url, data=req_data, headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg"
                })
                with urllib.request.urlopen(req, timeout=15) as resp:
                    audio_data = resp.read()

                audio_path = "/tmp/picar_speak.mp3"
                with open(audio_path, "wb") as f:
                    f.write(audio_data)

                subprocess.run(["pinctrl", "set", "20", "op", "dh"], check=False)
                threading.Thread(
                    target=lambda v=volume: subprocess.run(["mpg123", "-q", "-f", str(v), "-a", "plughw:2,0", audio_path], timeout=30),
                    daemon=True
                ).start()

                self._send_json(200, {"ok": True, "text": text, "brother": brother, "voice_id": voice_id})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": f"Speech failed: {str(e)}"})

        else:
            self._send_json(404, {"ok": False, "error": f"Unknown endpoint: {self.path}"})

    def log_message(self, format, *args):
        """Custom log format"""
        print(f"  [{time.strftime('%H:%M:%S')}] {args[0]}")


class DualStackHTTPServer(HTTPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def main():
    port = 8000
    server = DualStackHTTPServer(("::", port), PiCarHandler)

    print("=" * 50)
    print("  PICAR-X SERVER")
    print(f"  Running on port {port} (IPv4 + IPv6)")
    print(f"  Press Ctrl+C to stop")
    print("=" * 50)
    print()

    # Enable Robot HAT speaker (GPIO 20 = amplifier enable)
    subprocess.run(["pinctrl", "set", "20", "op", "dh"], check=False)
    time.sleep(0.75)
    print("  Speaker enabled")

    # Reset car to default position
    px.stop()
    px.set_dir_servo_angle(STEERING_OFFSET)
    px.set_cam_pan_angle(CAM_PAN_OFFSET)
    px.set_cam_tilt_angle(CAM_TILT_OFFSET)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down...")
        px.stop()
        px.set_dir_servo_angle(STEERING_OFFSET)
        px.set_cam_pan_angle(CAM_PAN_OFFSET)
        px.set_cam_tilt_angle(CAM_TILT_OFFSET)
        cam.stop()
        server.server_close()
        print("  Server stopped. Car safe.")


if __name__ == "__main__":
    main()
