from flask import Flask, Response, request, jsonify
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

# Voice configuration
VOICE_MODEL = "SAz9YHcvj6GT2YYXdXww"  # River - Relaxed, Neutral, Informative
USE_ELEVENLABS = True  # Set to False to use Piper TTS instead
SPEECH_FILE = os.environ.get("PICAR_SPEECH_FILE", "/home/chris/elevenlabs_speech.mp3")
AUDIO_PLAYER = os.environ.get("PICAR_AUDIO_PLAYER", "play")
AUDIO_OUTPUT = os.environ.get("PICAR_AUDIO_OUTPUT", "alsa")
AUDIO_DEVICE = os.environ.get("PICAR_AUDIO_DEVICE", "")
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
            time.sleep(0.2)
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
    with camera_lock:
        set_camera_size(size)
        Vilib.take_photo("current")
        time.sleep(0.5)
        path = photo_path("current")
        with open(path, "rb") as f:
            response = Response(f.read(), mimetype="image/jpeg")
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
        from robot_hat import utils
        utils.enable_speaker()
        return True, ""
    except Exception as e:
        return False, str(e)


def run_audio_command(command, engine, source):
    global audio_status
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
        "updated_at": started_at,
    }
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60)
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
        command = [AUDIO_PLAYER, "-q"]
        if AUDIO_OUTPUT:
            command.extend(["-o", AUDIO_OUTPUT])
        if AUDIO_DEVICE:
            command.extend(["-a", AUDIO_DEVICE])
        command.append(path)
        return command
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
    command = ["play", "-n", "synth", "1", "sine", "440", "vol", "0.8"]
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
    global observe_log
    data = request.get_json(force=True)
    author = data.get("author", "unknown")
    message = data.get("message", "")
    if message:
        observe_log.append({"author": author, "message": message})
        if len(observe_log) > 100:
            observe_log = observe_log[-100:]
    return jsonify({"ok": True})

@app.route("/handoff", methods=["POST"])
def handoff():
    global current_driver, observe_log
    data = request.get_json(force=True)
    action = data.get("action", "")
    driver = data.get("driver", "")
    if action == "take":
        current_driver = driver
        observe_log.append({"author": "system", "message": f"{driver} is now driving."})
    elif action == "release":
        observe_log.append({"author": "system", "message": f"{current_driver} has handed off the car."})
        current_driver = None
    return jsonify({"ok": True, "driver": current_driver})

@app.route("/live")
def live():
    return '''<!DOCTYPE html>
<html>
<head>
    <title>PiCar Live</title>
    <meta http-equiv="refresh" content="3">
    <style>
        body { font-family: monospace; background: #111; color: #eee; padding: 20px; }
        .driver { color: #4af; font-size: 1.2em; margin-bottom: 10px; }
        .msg { margin: 4px 0; }
        .system { color: #888; }
        .author { color: #4af; }
        img { width: 100%; max-width: 640px; display: block; margin-bottom: 10px; }
    </style>
</head>
<body>
    <img src="/camera?hires=false" />
    <div id="log"></div>
    <script>
        fetch('/observe').then(r=>r.json()).then(data=>{
            document.querySelector('.driver') || document.body.insertAdjacentHTML('afterbegin','<div class="driver"></div>');
            document.querySelector('.driver').textContent = 'Driver: ' + (data.driver || 'none');
            const log = document.getElementById('log');
            log.innerHTML = data.log.slice().reverse().map(m=>
                `<div class="msg"><span class="author">${m.author}:</span> ${m.message}</div>`
            ).join('');
        });
    </script>
</body>
</html>'''

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
