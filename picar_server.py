from flask import Flask, Response, request, jsonify, render_template
import os
from pathlib import Path
import subprocess
import threading
from flask_cors import CORS
from vilib import Vilib
from picarx import Picarx
import time

app = Flask(__name__)
CORS(app)
px = Picarx()

LOW_RES = (640, 480)
HIGH_RES = (1280, 720)
camera_lock = threading.Lock()
camera_size = LOW_RES

Vilib.camera_start(vflip=False, hflip=False, size=LOW_RES)
time.sleep(10)
Vilib.take_photo("warmup")

SPEED = 50
mission_log = []
current_mission = None
observe_log = []
current_driver = None
cam_pan = 0
cam_tilt = 0

# Voice configuration
VOICE_MODEL = "SAz9YHcvj6GT2YYXdXww"  # River - Relaxed, Neutral, Informative
USE_ELEVENLABS = True  # Set to False to use Piper TTS instead
SPEECH_FILE = os.environ.get("PICAR_SPEECH_FILE", "/home/chris/elevenlabs_speech.mp3")
AUDIO_PLAYER = os.environ.get("PICAR_AUDIO_PLAYER", "play")
AUDIO_OUTPUT = os.environ.get("PICAR_AUDIO_OUTPUT", "alsa")
AUDIO_DEVICE = os.environ.get("PICAR_AUDIO_DEVICE", "robothat")
SPEAKER_SETTLE_SECONDS = float(os.environ.get("PICAR_SPEAKER_SETTLE_SECONDS", "0.75"))
audio_lock = threading.Lock()
audio_status = {
    "ok": None,
    "engine": None,
    "player": AUDIO_PLAYER,
    "returncode": None,
    "stderr": "",
    "updated_at": None,
}

# Agent voice registry
VOICES = {
    "Cael": "lcDjPH5uMz9D85TM5h2g",   # Patrick - Steady and measured
    "Julian": "CwhRBWXzGAHq8TQ4Fs17",  # Roger
    "Varro": "IKne3meq5aSn9XLyUdCD",   # Charlie - Deep, Confident, Energetic
    "Soren": "JBFqnCBsd6RMkjVDRZzb",  # George - Warm, Captivating Storyteller
}


def set_camera_size(size):
    """Restart the camera when switching resolutions; Vilib may ignore hot starts."""
    global camera_size
    if camera_size == size:
        return
    try:
        if hasattr(Vilib, "camera_close"):
            Vilib.camera_close()
            time.sleep(1.5)
    except Exception as e:
        print(f"camera close before resize failed: {e}")
    Vilib.camera_start(vflip=False, hflip=False, size=size)
    time.sleep(1.0)
    camera_size = size


def photo_path(name):
    candidates = [
        Path("/root/Pictures/vilib") / f"{name}.jpg",
        Path("/home/chris/Pictures/vilib") / f"{name}.jpg",
        Path.home() / "Pictures" / "vilib" / f"{name}.jpg",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


@app.route("/camera", methods=["GET"])
def get_camera():
    hires = request.args.get("hires", "false").lower() == "true"
    size = HIGH_RES if hires else LOW_RES
    acquired = camera_lock.acquire(timeout=8)
    if not acquired:
        return jsonify({"error": "camera busy"}), 503
    try:
        set_camera_size(size)
        Vilib.take_photo("current")
        time.sleep(0.5)
        path = photo_path("current")
        with open(path, "rb") as f:
            response = Response(f.read(), mimetype="image/jpeg")
    finally:
        camera_lock.release()
    response.headers["X-Camera-Mode"] = "hires" if hires else "lowres"
    response.headers["X-Camera-Requested-Size"] = f"{size[0]}x{size[1]}"
    response.headers["X-Camera-File"] = str(path)
    return response

@app.route("/distance", methods=["GET"])
def get_distance():
    distance = round(px.ultrasonic.read(), 2)
    return jsonify({"distance": distance})


@app.route("/move", methods=["POST"])
def move():
    data = request.get_json(force=True)
    action = data.get("action")
    duration = data.get("duration", 0.5)

    if action == "forward":
        px.set_dir_servo_angle(3)
        px.forward(SPEED)
        time.sleep(duration)
        px.stop()
        px.set_dir_servo_angle(0)
    elif action == "backward":
        px.backward(SPEED)
        time.sleep(duration)
        px.stop()
    elif action == "left":
        px.set_dir_servo_angle(-25)
        px.forward(SPEED)
        time.sleep(duration)
        px.stop()
        px.set_dir_servo_angle(0)
    elif action == "right":
        px.set_dir_servo_angle(25)
        px.forward(SPEED)
        time.sleep(duration)
        px.stop()
        px.set_dir_servo_angle(0)
    elif action == "stop":
        px.stop()
    elif action == "look_left":
        px.set_cam_pan_angle(-30)
    elif action == "look_right":
        px.set_cam_pan_angle(30)
    elif action == "look_center":
        px.set_cam_pan_angle(0)
    elif action == "look_up":
        px.set_cam_tilt_angle(30)
    elif action == "look_down":
        px.set_cam_tilt_angle(-30)
    elif action == "look_reset":
        px.set_cam_pan_angle(0)
        px.set_cam_tilt_angle(0)
    else:
        return jsonify({"error": f"Unknown action: {action}"}), 400

    return jsonify({"ok": True, "action": action})


@app.route("/status", methods=["GET"])
def status():
    return jsonify({
        "current_mission": current_mission,
        "log": mission_log[-10:]
    })


@app.route("/mission", methods=["POST"])
def mission():
    global current_mission, mission_log
    data = request.get_json(force=True)
    instruction = data.get("instruction", "")
    mode = data.get("mode", "explore")
    target = data.get("target", None)
    current_mission = instruction
    mission_log = []

    def run_mission():
        global mission_log
        mission_log.append(f"Mission started: {instruction}")
        if mode == "explore":
            from picar_agent import explore
            explore(steps=20, log=mission_log)
        elif mode == "approach" and target:
            from picar_agent import approach
            approach(steps=40, log=mission_log, target=target)
        mission_log.append("Mission complete.")

    t = threading.Thread(target=run_mission, daemon=True)
    t.start()

    return jsonify({"ok": True, "instruction": instruction, "mode": mode})


def enable_robot_hat_speaker():
    try:
        from robot_hat import __device__
        from robot_hat.device import set_pin
        set_pin(__device__.spk_en, True)
        time.sleep(SPEAKER_SETTLE_SECONDS)
        return True, ""
    except Exception as e:
        return False, str(e)


def audio_env():
    env = os.environ.copy()
    env["AUDIODRIVER"] = AUDIO_OUTPUT
    env["AUDIODEV"] = AUDIO_DEVICE
    return env


def run_audio_command(command, engine, source):
    global audio_status
    with audio_lock:
        speaker_enabled, speaker_error = enable_robot_hat_speaker()
        started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        audio_status = {
            "ok": None,
            "engine": engine,
            "player": command[0] if command else None,
            "command": " ".join(command),
            "source": source,
            "returncode": None,
            "stdout": "",
            "stderr": "",
            "speaker_enabled": speaker_enabled,
            "speaker_error": speaker_error,
            "audio_driver": AUDIO_OUTPUT,
            "audio_device": AUDIO_DEVICE,
            "speaker_settle_seconds": SPEAKER_SETTLE_SECONDS,
            "updated_at": started_at,
        }
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=60, env=audio_env())
            audio_status.update({
                "ok": result.returncode == 0,
                "returncode": result.returncode,
                "stdout": (result.stdout or "")[-2000:],
                "stderr": " ".join(item for item in (speaker_error, result.stderr or "") if item)[-2000:],
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        except Exception as e:
            audio_status.update({
                "ok": False,
                "returncode": None,
                "stderr": " ".join(item for item in (speaker_error, str(e)) if item)[-2000:],
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        return audio_status.copy()


def audio_file_command(path):
    if AUDIO_PLAYER == "mpg123":
        # Use robothat ALSA device directly -- matches pcm.!default in asound.conf
        return [AUDIO_PLAYER, "-a", "robothat", path]
    if AUDIO_PLAYER == "sox":
        return [AUDIO_PLAYER, path, "-t", AUDIO_OUTPUT, AUDIO_DEVICE]
    return [AUDIO_PLAYER, "-q", path]


def play_file(path, engine):
    run_audio_command(audio_file_command(path), engine, path)


@app.route("/audio/status", methods=["GET"])
def audio_status_route():
    return jsonify(audio_status)


@app.route("/audio/test", methods=["POST"])
def audio_test():
    data = request.get_json(silent=True) or {}
    text = data.get("text", "PiCar audio test.")
    return speak_text(text, data.get("voice", VOICE_MODEL), wait=True)


@app.route("/audio/tone", methods=["POST"])
def audio_tone():
    command = [AUDIO_PLAYER, "-n", "synth", "1", "sine", "440", "vol", "0.8"]
    status = run_audio_command(command, "sox-tone", "generated-tone")
    return jsonify(status)


def speak_text(text, voice_param, wait=False):
    voice = VOICES.get(voice_param, voice_param)
    if not text:
        return jsonify({"error": "no text provided"}), 400
    if USE_ELEVENLABS:
        try:
            from elevenlabs.client import ElevenLabs
            from secret import ELEVENLABS_API_KEY
            el_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
            audio = el_client.text_to_speech.convert(
                text=text,
                voice_id=voice,
                model_id="eleven_turbo_v2_5",
                output_format="mp3_44100_128"
            )
            with open(SPEECH_FILE, "wb") as f:
                for chunk in audio:
                    f.write(chunk)
            file_bytes = os.path.getsize(SPEECH_FILE)
            if wait:
                status = run_audio_command(audio_file_command(SPEECH_FILE), "elevenlabs", SPEECH_FILE)
                status.update({
                    "text": text,
                    "voice": voice,
                    "file": SPEECH_FILE,
                    "file_bytes": file_bytes,
                })
                return jsonify(status)
            threading.Thread(target=play_file, args=(SPEECH_FILE, "elevenlabs"), daemon=True).start()
            return jsonify({
                "ok": True,
                "text": text,
                "voice": voice,
                "engine": "elevenlabs",
                "file": SPEECH_FILE,
                "file_bytes": file_bytes,
                "playback": "started",
                "audio_status_url": "/audio/status",
            })
        except Exception as e:
            print(f"ElevenLabs failed ({e}), falling back to Piper")
    def _piper():
        global audio_status
        try:
            speaker_enabled, speaker_error = enable_robot_hat_speaker()
            from picarx.tts import Piper
            tts = Piper()
            tts.set_model("en_US-ryan-low")
            tts.say(text)
            audio_status.update({
                "ok": True,
                "engine": "piper",
                "returncode": 0,
                "stderr": speaker_error,
                "speaker_enabled": speaker_enabled,
                "speaker_error": speaker_error,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        except Exception as e:
            audio_status.update({
                "ok": False,
                "engine": "piper",
                "returncode": None,
                "stderr": str(e),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
    threading.Thread(target=_piper, daemon=True).start()
    return jsonify({
        "ok": True,
        "text": text,
        "voice": "en_US-ryan-low",
        "engine": "piper",
        "playback": "started",
        "audio_status_url": "/audio/status",
    })


@app.route("/drive", methods=["POST"])
def drive():
    """Precise drive control: angle, direction, speed, duration.
    If continuous=true, starts motors and returns immediately (use /stop to stop).
    If duration > 0, drives for that duration then stops."""
    data = request.get_json(force=True)
    angle = max(-35, min(35, int(data.get("angle", 0))))
    direction = data.get("direction", "forward")
    speed = max(1, min(50, int(data.get("speed", SPEED))))
    duration = max(0, min(5.0, float(data.get("duration", 0))))
    continuous = data.get("continuous", False)

    px.set_dir_servo_angle(angle + 3)  # +3 drift correction
    if direction == "forward":
        px.forward(speed)
    else:
        px.backward(speed)

    if not continuous and duration > 0:
        time.sleep(duration)
        px.stop()
        px.set_dir_servo_angle(0)

    return jsonify({"ok": True, "angle": angle, "direction": direction, "speed": speed, "continuous": continuous})


@app.route("/look", methods=["POST"])
def look():
    """Absolute camera positioning: pan and tilt in degrees."""
    global cam_pan, cam_tilt
    data = request.get_json(force=True)
    pan = max(-35, min(35, int(data.get("pan", 0))))
    tilt = max(-20, min(20, int(data.get("tilt", 0))))
    cam_pan = pan
    cam_tilt = tilt
    px.set_cam_pan_angle(pan)
    px.set_cam_tilt_angle(tilt)
    return jsonify({"ok": True, "pan": pan, "tilt": tilt})


@app.route("/stop", methods=["POST"])
def stop():
    """Emergency stop."""
    px.stop()
    px.set_dir_servo_angle(0)
    return jsonify({"ok": True})


@app.route("/car_state", methods=["GET"])
def car_state():
    """Current car state for the control page."""
    return jsonify({
        "driver": current_driver,
        "cam_pan": cam_pan,
        "cam_tilt": cam_tilt,
    })


@app.route("/speak", methods=["POST"])
def speak():
    data = request.get_json(force=True)
    text = data.get("text", "")
    voice_param = data.get("voice", VOICE_MODEL)
    return speak_text(text, voice_param)

@app.route("/voices", methods=["GET"])
def list_voices():
    try:
        from elevenlabs.client import ElevenLabs
        from secret import ELEVENLABS_API_KEY
        el_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
        response = el_client.voices.search()
        voices = [{"name": v.name, "voice_id": v.voice_id, "description": v.description} 
                  for v in response.voices]
        return jsonify({"voices": voices})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route("/observe", methods=["GET"])
def observe():
    return jsonify({
        "driver": current_driver,
        "log": observe_log[-20:]
    })

@app.route("/observe", methods=["POST"])
def observe_post():
    global observe_log, passenger_list
    data = request.get_json(force=True)
    author = data.get("author", "unknown")
    message = data.get("message", "")
    if message:
        observe_log.append({"author": author, "message": message})
        if len(observe_log) > 100:
            observe_log = observe_log[-100:]
        # Auto-register anyone who posts as a passenger
        if author and author != "system" and author not in passenger_list:
            passenger_list.append(author)
    return jsonify({"ok": True})

@app.route("/queue", methods=["GET"])
def get_queue():
    global wheel_available_since
    claim_expires = None
    if wheel_available_since:
        elapsed = time.time() - wheel_available_since
        remaining = max(0, CLAIM_WINDOW_SECONDS - elapsed)
        if remaining == 0:
            # Window expired — advance queue
            advance_queue()
        else:
            claim_expires = round(remaining)
    return jsonify({
        "driver": current_driver,
        "queue": driver_queue,
        "claim_expires": claim_expires
    })


@app.route("/queue", methods=["POST"])
def update_queue():
    global driver_queue
    data = request.get_json(force=True)
    action = data.get("action", "")
    name = data.get("name", "").strip()
    intention = data.get("intention", "").strip()

    if not name:
        return jsonify({"error": "name required"}), 400

    if action == "join":
        # Remove if already in queue, then add/update
        driver_queue = [q for q in driver_queue if q["name"] != name]
        driver_queue.append({"name": name, "intention": intention, "queued_at": time.time()})
        observe_log.append({"author": "system", "message": f"{name} joined the queue" + (f": {intention}" if intention else "")})
    elif action == "leave":
        driver_queue = [q for q in driver_queue if q["name"] != name]
        observe_log.append({"author": "system", "message": f"{name} left the queue"})

    return jsonify({"ok": True, "queue": driver_queue})


def advance_queue():
    """Called when claim window expires — skip first in queue."""
    global driver_queue, wheel_available_since
    if driver_queue:
        skipped = driver_queue.pop(0)
        observe_log.append({"author": "system", "message": f"{skipped['name']} did not claim the wheel in time — skipping"})
        if driver_queue:
            # Start new claim window for next in queue
            wheel_available_since = time.time()
            next_up = driver_queue[0]
            observe_log.append({"author": "system", "message": f"Wheel available — {next_up['name']} has {CLAIM_WINDOW_SECONDS}s to claim"})
        else:
            wheel_available_since = None
    else:
        wheel_available_since = None


@app.route("/handoff", methods=["POST"])
def handoff():
    global current_driver, observe_log, passenger_list, driver_queue, wheel_available_since
    data = request.get_json(force=True)
    action = data.get("action", "")
    driver = data.get("driver", "")
    if action == "take":
        current_driver = driver
        wheel_available_since = None
        # Remove from queue if they were waiting
        driver_queue = [q for q in driver_queue if q["name"] != driver]
        if driver and driver not in passenger_list:
            passenger_list.append(driver)
        observe_log.append({"author": "system", "message": f"{driver} is now driving."})
    elif action == "release":
        observe_log.append({"author": "system", "message": f"{current_driver} has handed off the car."})
        current_driver = None
        # Start claim window if queue has someone waiting
        if driver_queue:
            wheel_available_since = time.time()
            next_up = driver_queue[0]
            observe_log.append({"author": "system", "message": f"Wheel available — {next_up['name']} has {CLAIM_WINDOW_SECONDS}s to claim" + (f" | Intention: {next_up['intention']}" if next_up.get('intention') else "")})
        else:
            wheel_available_since = None
    return jsonify({"ok": True, "driver": current_driver})

@app.route("/listen", methods=["POST"])
def listen():
    global observe_log
    author = request.form.get("author", "Chris")
    audio_file = request.files.get("audio")
    if not audio_file:
        return jsonify({"ok": False, "error": "no audio provided"}), 400
    try:
        audio_path = "/tmp/picar_listen_upload.webm"
        audio_file.save(audio_path)
        from openai import OpenAI
        from openai_secret import OPENAI_API_KEY
        client = OpenAI(api_key=OPENAI_API_KEY)
        with open(audio_path, "rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f
            )
        text = transcript.text.strip()
        if text:
            observe_log.append({"author": author, "message": text})
            if len(observe_log) > 100:
                observe_log = observe_log[-100:]
        return jsonify({"ok": True, "text": text, "author": author})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/live")
def live():
    return '''<!doctype html>
<html lang="en">

    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="index,follow">
        <meta name="googlebot" content="index,follow">
        <style>
            html {
                width: 100%;
                min-width: 100%;
                margin: 0 auto;
                padding: 0;
                font-family: Roboto, "Helvetica Neue", Arial, sans-serif;
                font-size: 16px;
                color: white;
                scroll-behavior: smooth;
                -webkit-text-size-adjust: none;
                -moz-osx-font-smoothing: auto;
                -webkit-font-smoothing: auto;
            }

            body {
                width: 100%;
                margin: 0 auto;
                padding: 1rem;
                background: #0a0a0a;
            }

            * {
                -webkit-box-sizing: border-box;
                -moz-box-sizing: border-box;
                box-sizing: border-box;
            }

            section {
                display: flex;
                flex-direction: column;
                width: 100%;
                margin: 0;
                padding: 1rem 0;
                gap: 1rem;
            }

            figure {
                display: flex;
                align-items: flex-start;
                width: 100%;
                height: auto;
                aspect-ratio: 4/3;
                margin: 0;
            }

            .log-panel {
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            }

            img, picture, source {
                display: block;
                width: 100%;
                max-width: 100%;
                height: auto;
                margin: 0;
                shape-margin: 0.75rem;
            }

            .driver, .system, .author {
                font-weight: bold;
            }

            .driver, .author {
                color: #ff4d00;
            }

            .msg {
                padding-top: 0.5rem;
            }

            .msg:first-of-type {
                padding-top: 0;
            }

            .system {
                color: #888;
            }

            #mic-btn {
                width: 100%;
                padding: 0.75rem;
                background: #ff4d00;
                color: white;
                border: none;
                border-radius: 0.5rem;
                font-size: 1rem;
                cursor: pointer;
                font-weight: bold;
                user-select: none;
                -webkit-user-select: none;
                margin-top: 0.25rem;
            }

            .chat-form {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
                padding-bottom: 0.5rem;
                border-bottom: 1px solid #222;
            }

            .chat-name {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-size: 0.8rem;
                color: #888;
            }

            .chat-name input {
                background: #1a1a1a;
                color: #ff4d00;
                border: 1px solid #333;
                border-radius: 0.5rem;
                padding: 0.25rem 0.5rem;
                font-size: 0.8rem;
                width: 8rem;
                font-weight: bold;
            }

            .chat-row {
                display: flex;
                gap: 0.5rem;
            }

            .chat-row input[type="text"] {
                flex: 1;
                padding: 0.5rem 0.75rem;
                background: #1a1a1a;
                color: white;
                border: 1px solid #333;
                border-radius: 0.5rem;
                font-size: 0.95rem;
            }

            .chat-row button {
                padding: 0.5rem 1rem;
                background: #ff4d00;
                color: white;
                border: none;
                border-radius: 0.5rem;
                font-size: 0.95rem;
                cursor: pointer;
                font-weight: bold;
            }

            .chat-row button:active {
                background: #cc3d00;
            }

            @media (min-width: 56rem) {
                section {
                    flex-direction: row;
                }

                figure,
                .log-panel {
                    max-width: 50%;
                }
            }
        </style>
    </head>

    <body>
        <section>
            <figure>
                <img src="/camera?hires=false" />
            </figure>
            <div class="log-panel">
                <div class="driver">Driver: none</div>
                <div class="chat-form">
                    <div class="chat-name">
                        <span>Your name:</span>
                        <input id="operator-name" type="text" placeholder="e.g. Chris" maxlength="32" />
                    </div>
                    <div class="chat-row">
                        <input id="chat-input" type="text" placeholder="Say something to the car\u2026" />
                        <button onclick="sendMessage()">Send</button>
                    </div>
                    <button id="mic-btn" ontouchstart="startRecording(event)" ontouchend="stopRecording(event)" onmousedown="startRecording(event)" onmouseup="stopRecording(event)">
                        Hold to Talk
                    </button>
                </div>
                <div id="log"></div>
            </div>
        </section>
        <script>
            const nameInput = document.getElementById(\'operator-name\');
            nameInput.value = localStorage.getItem(\'picar-operator-name\') || \'\';
            nameInput.addEventListener(\'change\', function() {
                localStorage.setItem(\'picar-operator-name\', this.value.trim());
            });

            function sendMessage() {
                const name = nameInput.value.trim() || \'Operator\';
                const input = document.getElementById(\'chat-input\');
                const text = input.value.trim();
                if (!text) return;
                fetch(\'/observe\', {
                    method: \'POST\',
                    headers: {\'Content-Type\': \'application/json\'},
                    body: JSON.stringify({author: name, message: text})
                }).then(() => { input.value = \'\'; });
            }

            document.getElementById(\'chat-input\').addEventListener(\'keydown\', function(e) {
                if (e.key === \'Enter\') sendMessage();
            });

            function refreshCamera() {
                const img = document.querySelector(\'img\');
                img.src = \'/camera?hires=false&t=\' + Date.now();
            }

            function refreshLog() {
                fetch(\'/observe\').then(r => r.json()).then(data => {
                    document.querySelector(\'.driver\').textContent = \'Driver: \' + (data.driver || \'none\');
                    const log = document.getElementById(\'log\');
                    log.innerHTML = data.log.slice().reverse().map(m =>
                        `<div class="msg"><span class="author">${m.author}:</span> ${m.message}</div>`
                    ).join(\'\');
                });
            }

            refreshLog();
            setInterval(refreshLog, 5000);
            setInterval(refreshCamera, 5000);

            // Push-to-talk
            let mediaRecorder = null;
            let audioChunks = [];

            async function startRecording(e) {
                e.preventDefault();
                const btn = document.getElementById('mic-btn');
                btn.style.background = '#cc0000';
                btn.textContent = 'Recording...';
                audioChunks = [];
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaRecorder = new MediaRecorder(stream);
                    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
                    mediaRecorder.onstop = async () => {
                        const blob = new Blob(audioChunks, { type: 'audio/webm' });
                        const name = nameInput.value.trim() || 'Operator';
                        const form = new FormData();
                        form.append('audio', blob, 'speech.webm');
                        form.append('author', name);
                        btn.textContent = 'Transcribing...';
                        try {
                            const res = await fetch('/listen', { method: 'POST', body: form });
                            const data = await res.json();
                            console.log('Transcribed:', data.text);
                        } catch(err) {
                            console.error('Transcription error:', err);
                        }
                        btn.style.background = '#ff4d00';
                        btn.textContent = 'Hold to Talk';
                        stream.getTracks().forEach(t => t.stop());
                    };
                    mediaRecorder.start();
                } catch(err) {
                    btn.style.background = '#ff4d00';
                    btn.textContent = 'Hold to Talk';
                    console.error('Mic error:', err);
                }
            }

            function stopRecording(e) {
                e.preventDefault();
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
            }
        </script>
    </body>

</html>'''


# In-memory passenger list
passenger_list = []

# Driver queue: [{name, intention, queued_at}]
driver_queue = []
wheel_available_since = None  # timestamp when wheel was released, for claim window
CLAIM_WINDOW_SECONDS = 30

@app.route("/passengers", methods=["GET"])
def get_passengers():
    return jsonify({"driver": current_driver, "passengers": passenger_list})

@app.route("/passengers", methods=["POST"])
def update_passengers():
    global passenger_list
    data = request.get_json(force=True)
    action = data.get("action", "")
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    if action == "join":
        if name not in passenger_list:
            passenger_list.append(name)
    elif action == "leave":
        passenger_list = [p for p in passenger_list if p != name]
    return jsonify({"ok": True, "passengers": passenger_list})


@app.route("/control")
def control():
    return render_template("control.html")


@app.route("/console")
def console():
    return render_template("console.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)


















