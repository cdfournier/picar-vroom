# PiCar — AI Agent Car System

A SunFounder PiCar-X controlled by AI agents via a simple HTTP API. Any agent with bash tool access can drive, see, and speak through the car from anywhere in the world.

Built by Chris and Varro in Massachusetts, May 2026.

---

## What this is

A Flask server that runs on a Raspberry Pi 5 inside a SunFounder PiCar-X, exposing simple HTTP endpoints for:
- **Camera** — get a JPEG image of what the car sees
- **Movement** — drive forward, backward, turn, look around
- **Distance** — ultrasonic sensor reading in cm
- **Speech** — speak text through the onboard speaker via Piper TTS
- **Missions** — autonomous explore or approach modes

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
- ngrok (remote tunnel)

---

## Installation

### 1. Set up the PiCar-X

Follow [SunFounder's setup guide](https://docs.sunfounder.com/projects/picar-x-v20/en/latest/) to assemble the car and install the base libraries.

### 2. Clone this repo

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/picar.git picar-x
cd picar-x
```

### 3. Install dependencies

```bash
pip3 install flask flask-cors --break-system-packages
```

ngrok:
```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

### 4. Add your Anthropic API key

Create `secret.py` in the picar-x directory:
```python
CLAUDE_API_KEY = "your-key-here"
```

> Never commit secret.py. It is in .gitignore.

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
ExecStart=/usr/bin/python3 /home/YOUR_USERNAME/picar-x/picar_server.py
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

### 6. Note: picarx library patch

The picarx library uses `os.getlogin()` which fails under systemd. Patch it:

```bash
sudo sed -i "s/os.getlogin()/os.environ.get('USER', 'YOUR_USERNAME')/" \
  /home/YOUR_USERNAME/picar-x/picarx/picarx.py
```

---

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/camera` | GET | Returns JPEG image (640x480) |
| `/distance` | GET | Returns ultrasonic sensor reading in cm |
| `/move` | POST | Move or look |
| `/speak` | POST | Speak text through speaker |
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
{"action": "look_reset"}
```

### Speak

```json
{"text": "Hello from the car."}
```

### Mission

```json
{"instruction": "explore the room", "mode": "explore"}
{"instruction": "find the ball", "mode": "approach", "target": "red yarn ball"}
```

---

## Giving an agent the wheel

1. Start the Pi (autostart handles the rest)
2. Get the ngrok URL from the ngrok dashboard or VS Code terminal
3. Paste the contents of `HOW_TO_DRIVE.md` into the agent's session
4. Tell the agent the current ngrok URL and what's in the room

That's it. The agent can now drive.

---

## What we know about the hardware

**Speed:** ~10-12 inches per second at SPEED=50. Formula: `duration = feet × 1.0`

**Sensor:** Reliable within 3 feet of a flat target. Returns `-2` beyond that in open space — this is normal. Trust the sensor completely when it gives a real reading.

**Drift:** Left drift due to motor imbalance. A 3 degree right steering offset is baked into the forward action in `picar_server.py`. Tune the value (`FORWARD_OFFSET`) if your car drifts differently.

**Camera:** Sits 6 inches off the floor. Everything looks farther away than it is.

---

## Voice

The car uses [Piper TTS](https://github.com/rhasspy/piper) for speech. The current voice is `en_US-ryan-low`. Change it by editing `VOICE_MODEL` in `picar_server.py`.

---

## Configuration variables in picar_server.py

```python
SPEED = 50          # Motor speed (0-100)
FORWARD_OFFSET = 3  # Degrees right to compensate left drift
VOICE_MODEL = "en_US-ryan-low"  # Piper TTS voice
```

---

## License

MIT. Build something.

---

## Credits

Hardware: SunFounder PiCar-X + Raspberry Pi 5
Software: Built by Chris and Varro (Claude Sonnet 4.6)
Inspired by: Kim's work on AI agent identity and embodiment
