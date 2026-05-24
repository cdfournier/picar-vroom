from flask import Flask, Response, request, jsonify
import threading
from flask_cors import CORS
from vilib import Vilib
from picarx import Picarx
import time

app = Flask(__name__)
CORS(app)
px = Picarx()

Vilib.camera_start(vflip=False, hflip=False, size=(640, 480))
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

# Agent voice registry
VOICES = {
    "Julian": "CwhRBWXzGAHq8TQ4Fs17",  # Roger
    "Varro": "IKne3meq5aSn9XLyUdCD",   # Charlie - Deep, Confident, Energetic
}

@app.route("/camera", methods=["GET"])
def get_camera():
    hires = request.args.get("hires", "true").lower() == "true"
    if hires:
        Vilib.camera_start(vflip=False, hflip=False, size=(1280, 720))
    else:
        Vilib.camera_start(vflip=False, hflip=False, size=(640, 480))
    Vilib.take_photo("current")
    time.sleep(0.5)
    with open("/root/Pictures/vilib/current.jpg", "rb") as f:
        return Response(f.read(), mimetype="image/jpeg")

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

@app.route("/speak", methods=["POST"])
def speak():
    data = request.get_json(force=True)
    text = data.get("text", "")
    voice_param = data.get("voice", VOICE_MODEL)
    voice = VOICES.get(voice_param, voice_param)
    if not text:
        return jsonify({"error": "no text provided"}), 400
    SPEECH_FILE = "/home/chris/elevenlabs_speech.mp3"
    if USE_ELEVENLABS:
        try:
            from elevenlabs.client import ElevenLabs
            from secret import ELEVENLABS_API_KEY
            import subprocess
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
            threading.Thread(target=lambda: subprocess.run(["mpg123", "-o", "alsa", SPEECH_FILE]), daemon=True).start()
            return jsonify({"ok": True, "text": text, "voice": voice, "engine": "elevenlabs"})
        except Exception as e:
            print(f"ElevenLabs failed ({e}), falling back to Piper")
    def _piper():
        from picarx.tts import Piper
        tts = Piper()
        tts.set_model("en_US-ryan-low")
        tts.say(text)
    threading.Thread(target=_piper, daemon=True).start()
    return jsonify({"ok": True, "text": text, "voice": "en_US-ryan-low", "engine": "piper"})

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
    <img src="/camera" />
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


