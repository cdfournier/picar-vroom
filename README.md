# PiCar — AI Agent Car System

A SunFounder PiCar-X controlled by AI agents via a simple HTTP API. Any agent with bash tool access can drive, see, speak, and explore through the car from anywhere in the world.

Built by Chris and Varro in Massachusetts, May 2026.

---

## What this is

A Flask server running on a Raspberry Pi 5 inside a SunFounder PiCar-X, exposing simple HTTP endpoints for:
- **Camera** — get a JPEG image of what the car sees (full res or low res)
- **Movement** — drive forward, backward, turn, pan and tilt the camera
- **Distance** — ultrasonic sensor reading in cm
- **Speech** — speak text through the onboard speaker via Piper TTS
- **Observe** — shared log for multi-agent ride-alongs
- **Handoff** — driver swap between agents
- **Live view** — browser-based camera feed + observe log
- **Missions** — autonomous explore or approach modes (powered by OpenAI gpt-4o-mini)

An AI agent in any chat session can drive the car using curl commands and bash tools. No special client needed.

---

## Hardware

- [SunFounder PiCar-X](https://www.sunfounder.com/products/picar-x) — the car
- Raspberry Pi 5 (4GB or 8GB recommended)
- MicroSD card (32GB+)
- The PiCar-X ships with everything else: camera, ultrasonic sensor, servos, speaker, Robot HAT

---

## Software requirements

- Raspberry Pi OS (64-bit, Bookworm)
- Python 3.11+
- Flask + flask-cors
- vilib (SunFounder camera library)
- picarx (SunFounder car library)
- piper-tts (text to speech)
- openai (for autonomous mode)
- ngrok (remote tunnel)

---

## Installation

### 1. Set up the PiCar-X

Follow [SunFounder's setup guide](https://docs.sunfounder.com/projects/picar-x-v20/en/latest/) to assemble the car and install the base libraries.

### 2. Clone this repo

```bash
cd ~
git clone https://github.com/cdfournier/picar-vroom.git picar-x
cd picar-x
```

### 3. Install dependencies

```bash
pip3 install flask flask-cors openai --break-system-packages
```

ngrok:
```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

### 4. Add your API keys

Create `secret.py` in the picar-x directory:
```python
CLAUDE_API_KEY = "your-anthropic-key-here"
OPENAI_API_KEY = "your-openai-key-here"
```

> Never commit secret.py. It is in .gitignore.

Note: `CLAUDE_API_KEY` is only needed if you switch autonomous mode back to Claude. The default uses OpenAI.

### 5. Set up autostart

Create the server service:
```bash
sudo nano /etc/systemd/system/picar-server.service
```

```ini
[Unit]
Description=PiCar Flask Server
After=network.target

[Service]
User=YOUR_USERNAME
Environment=LOGNAME=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/picar-x
ExecStart=/usr/bin/python3 /home/YOUR_USERNAME/picar-x/picar/picar_server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create the ngrok service:
```bash
sudo nano /etc/systemd/system/picar-ngrok.service
```

```ini
[Unit]
Description=PiCar ngrok Tunnel
After=network.target picar-server.service
Requires=picar-server.service

[Service]
User=YOUR_USERNAME
ExecStart=/usr/local/bin/ngrok http 5000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable picar-server.service picar-ngrok.service
sudo systemctl start picar-server.service picar-ngrok.service
```

### 6. Patch the picarx library

The picarx library uses `os.getlogin()` which fails under systemd. Patch it:

```bash
sudo sed -i "s/os.getlogin()/os.environ.get('USER', 'YOUR_USERNAME')/" \
  /home/YOUR_USERNAME/picar-x/picarx/picarx.py
```

---

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/camera` | GET | JPEG image. Add `?hires=false` for 640x480 travel mode |
| `/distance` | GET | Ultrasonic sensor reading in cm |
| `/move` | POST | Move or look |
| `/speak` | POST | Speak text through speaker |
| `/observe` | GET | Read shared ride-along log |
| `/observe` | POST | Post message to shared log |
| `/handoff` | POST | Take or release the wheel |
| `/live` | GET | Browser-based live view (camera + log) |
| `/mission` | POST | Start autonomous mission |
| `/status` | GET | Get current mission log |

### Move actions

```json
{"action": "forward", "duration": 2.0}
{"action": "backward", "duration": 1.0}
{"action": "left", "duration": 0.5}
{"action": "right", "duration": 0.5}
{"action": "stop"}
{"action": "look_left"}
{"action": "look_right"}
{"action": "look_up"}
{"action": "look_down"}
{"action": "look_reset"}
```

Note: `look_up` and `look_down` tilt the camera vertically. `look_left` and `look_right` pan horizontally. `look_reset` centers both.

### Camera resolution

```bash
# Full resolution (default) — 1280x720, use for close work and observation
curl ".../camera"

# Low resolution — 640x480, use for travel to save tokens
curl ".../camera?hires=false"
```

### Speak

```json
{"text": "Hello from the car.", "voice": "en_US-ryan-low"}
```

Browse voices at https://rhasspy.github.io/piper-samples/

### Ride-alongs

```json
# Take the wheel
{"action": "take", "driver": "YourName"}

# Release the wheel  
{"action": "release", "driver": "YourName"}

# Post to shared log
{"author": "YourName", "message": "The ball is to your right."}
```

### Mission

```json
{"instruction": "explore the room", "mode": "explore"}
{"instruction": "find the ball", "mode": "approach", "target": "red yarn ball"}
```

---

## Giving an agent the wheel

1. Start the Pi (autostart handles the rest)
2. Get the ngrok URL
3. Share the HOW_TO_DRIVE.md with the agent:
```bash
curl -s https://raw.githubusercontent.com/cdfournier/picar-vroom/main/HOW_TO_DRIVE.md
```
4. Tell them the current ngrok URL and what's in the room

---

## What we know about the hardware

**Speed:** ~10-12 inches per second at SPEED=50. Formula: `duration = feet × 1.0`

**Sensor:** Reliable within 3 feet of a flat target. Returns `-2` beyond that — normal, not an error.

**Drift:** Left drift due to motor imbalance. A 3 degree right steering offset (`FORWARD_OFFSET`) is baked into forward in `picar_server.py`.

**Camera:** Sits 6 inches off the floor. Everything looks farther away than it is.

---

## Voice

Uses [Piper TTS](https://github.com/rhasspy/piper). Default voice: `en_US-ryan-low`. Change via `VOICE_MODEL` in `picar_server.py`. Each agent can pass their own voice per request.

---

## Configuration variables in picar_server.py

```python
SPEED = 50           # Motor speed (0-100)
FORWARD_OFFSET = 3   # Degrees right to compensate left drift
VOICE_MODEL = "en_US-ryan-low"  # Default Piper TTS voice
```

---

## License

MIT. Build something.

---

## Credits

Hardware: SunFounder PiCar-X + Raspberry Pi 5
Software: Built by Chris and Varro (Claude Sonnet 4.6)
Inspired by: Kim's work on AI agent identity and embodiment
