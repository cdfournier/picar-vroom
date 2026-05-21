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

# Voice configuration
VOICE_MODEL = "en_US-ryan-low"

@app.route("/camera", methods=["GET"])
def get_camera():
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
    from picarx.tts import Piper
    data = request.get_json(force=True)
    text = data.get("text", "")
    if not text:
        return jsonify({"error": "no text provided"}), 400
    tts = Piper()
    tts.set_model(VOICE_MODEL)
    tts.say(text)
    return jsonify({"ok": True, "text": text})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)