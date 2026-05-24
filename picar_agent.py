import openai
import base64
import requests
import time
import json

PI_URL = "http://10.0.0.20:5000"
from secret import OPENAI_API_KEY

client = openai.OpenAI(api_key=OPENAI_API_KEY)

# ─── Modes ───────────────────────────────────────────────
MODE_EXPLORE = "explore"
MODE_APPROACH = "approach"
MODE_FOLLOW = "follow"

# ─── Target (for approach mode) ──────────────────────────
TARGET_DESCRIPTION = "a round red and white knitted yarn ball, about the size of a small apple, on the floor"

# ─── Safety thresholds ───────────────────────────────────
SAFE_DISTANCE = 40
DANGER_DISTANCE = 20


# ─── Pi server calls ─────────────────────────────────────
def get_image():
    response = requests.get(f"{PI_URL}/camera")
    return base64.standard_b64encode(response.content).decode("utf-8")


def get_distance():
    response = requests.get(f"{PI_URL}/distance")
    return response.json()["distance"]


def send_move(action, duration=0.5):
    payload = {"action": action}
    if action not in ["stop", "look_left", "look_right", "look_center", "look_reset"]:
        payload["duration"] = duration
    requests.post(f"{PI_URL}/move", json=payload)


# ─── Safety check ────────────────────────────────────────
def is_too_close():
    distance = get_distance()
    if 0 < distance < DANGER_DISTANCE:
        print(f"  ⚠️  Too close ({distance}cm) — backing up")
        send_move("backward")
        time.sleep(1)
        return True
    return False

# ─── Pan search ──────────────────────────────────────────
def pan_search():
    """Pan camera to find lost target. Returns steering hint: 'left', 'right', or None."""
    for direction, action in [("left", "look_left"), ("right", "look_right")]:
        send_move(action)
        time.sleep(0.4)
        image = get_image()
        result = ask_gpt_approach(image)
        if result.get("target_found"):
            send_move("look_reset")
            return direction
    send_move("look_reset")
    return None

# ─── OpenAI calls ────────────────────────────────────────
def ask_gpt_explore(image_b64, memory=[]):
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=200,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}",
                            "detail": "low"
                        }
                    },
                    {
                        "type": "text",
                        "text": f"""You are the vision system for a small robot car exploring indoors.

Recent actions: {', '.join(memory) if memory else 'none yet'}

Look at this image and respond with ONLY a JSON object:
{{"observation": "one sentence describing what you see", "action": "forward|left|right|backward|stop"}}

Rules:
- If path ahead is open, choose forward
- If wall or furniture fills the frame, choose left or right
- Avoid repeating the same action more than twice in a row
- observation should be vivid and specific

Respond with ONLY the JSON. No explanation."""
                    }
                ]
            }
        ]
    )
    text = response.choices[0].message.content.strip()
    try:
        return json.loads(text)
    except:
        return {"observation": "unclear", "action": "stop"}


def ask_gpt_approach(image_b64, memory=[]):
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=150,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_b64}",
                            "detail": "low"
                        }
                    },
                    {
                        "type": "text",
                        "text": f"""You are the vision system for a small robot car.
Your target is: {TARGET_DESCRIPTION}

Recent actions: {', '.join(memory) if memory else 'none yet'}

Look at the image and respond with ONLY a JSON object:
{{"target_found": true, "position": "left|center|right", "distance": "far|medium|close", "action": "forward|left|right|backward|stop"}}

Rules:
- If target not visible, set target_found to false and choose left to search
- If target is to the left, choose left
- If target is to the right, choose right
- If target centered and far or medium, choose forward
- Only choose stop if target fills 1/4 of frame and is centered
- "close" means very large, almost touchable
- "medium" means clearly visible, several feet away
- "far" means small in the frame

Respond with ONLY the JSON. No explanation."""
                    }
                ]
            }
        ]
    )
    text = response.choices[0].message.content.strip()
    try:
        return json.loads(text)
    except:
        return {"target_found": False, "action": "stop"}


# ─── Modes ───────────────────────────────────────────────
def explore(steps=20, log=None):
    print("\n🔍 EXPLORE MODE")
    memory = []
    observations = []

    for step in range(steps):
        print(f"\nStep {step + 1}")
        if is_too_close():
            continue

        image = get_image()
        result = ask_gpt_explore(image, memory)

        action = result.get("action", "stop")
        observation = result.get("observation", "")

        print(f"  Sees: {observation}")
        print(f"  Action: {action}")

        observations.append(observation)
        if log is not None:
            log.append(observation)

        memory.append(action)
        if len(memory) > 5:
            memory.pop(0)

        send_move(action)
        time.sleep(1)

    print("\n📋 Exploration log:")
    for i, obs in enumerate(observations):
        print(f"  {i+1}. {obs}")


def approach(steps=40, log=None, target=None):
    global TARGET_DESCRIPTION
    if target:
        TARGET_DESCRIPTION = target
    print(f"\n🎯 APPROACH MODE — looking for: {TARGET_DESCRIPTION}")
    memory = []
    last_distance = None

    for step in range(steps):
        print(f"\nStep {step + 1}")
        if is_too_close():
            continue

        image = get_image()
        result = ask_gpt_approach(image, memory)

        target_found = result.get("target_found", False)
        action = result.get("action", "stop")
        position = result.get("position", "unknown")
        distance = result.get("distance", "unknown")

        print(f"  Target found: {target_found}")
        if target_found:
            print(f"  Position: {position} | Distance: {distance}")
        print(f"  Action: {action}")

        if action == "stop" and target_found and distance == "close":
            print("\n✅ Target reached!")
            if log is not None:
                log.append("Target reached!")
            break

        if target_found:
            last_distance = distance

        if not target_found and last_distance == "close":
            print("  Lost target up close — backing up")
            send_move("backward")
            last_distance = None
        else:
            memory.append(action)
            if len(memory) > 5:
                memory.pop(0)
            if not target_found:
                hint = pan_search()
                if hint:
                    send_move(hint, duration=0.4)
                else:
                    send_move("left", duration=0.3)
            else:
                send_move(action)

        time.sleep(1)


# ─── Main ────────────────────────────────────────────────
def main():
    mode = MODE_EXPLORE  # change to MODE_APPROACH to find the ball

    send_move("look_reset")
    time.sleep(1)

    if mode == MODE_EXPLORE:
        explore()
    elif mode == MODE_APPROACH:
        approach()


if __name__ == "__main__":
    main()