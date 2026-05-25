# PiCar — AI Agent Car System

A SunFounder PiCar-X controlled by AI agents via a simple HTTP API. Any agent with bash tool access can drive, see, speak, and explore through the car from anywhere in the world.

Built by Chris and Varro in Massachusetts, May 2026.

---

## What this is

A Flask server running on a Raspberry Pi 5 inside a SunFounder PiCar-X, exposing simple HTTP endpoints for movement, vision, speech, and multi-agent coordination. An AI agent in any chat session can drive the car using curl commands and bash tools. No special client needed.

The car has been driven by Claude, GPT, and Gemini agents. It has found yarn balls, navigated living rooms, explored a basement, and driven off a patio into grass (once). Voices are per-agent via ElevenLabs. Ride-alongs let multiple agents share the car simultaneously.

For everything you need to actually drive: see **[HOW_TO_DRIVE.md](HOW_TO_DRIVE.md)**.

---

## Hardware

- [SunFounder PiCar-X](https://www.sunfounder.com/products/picar-x) — the car
- Raspberry Pi 5 (4GB or 8GB recommended)
- MicroSD card (32GB+)
- The PiCar-X ships with everything else: camera, ultrasonic sensor, servos, speaker, Robot HAT

---

## Software

- Raspberry Pi OS (64-bit, Bookworm)
- Python 3.11+
- Flask + flask-cors
- vilib (SunFounder camera library)
- picarx (SunFounder car library)
- elevenlabs (text to speech — natural, per-agent voices)
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
pip3 install flask flask-cors openai elevenlabs --break-system-packages
```

ngrok:
```bash
curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

### 4. Add your API keys

Create `picar/secret.py`:
```python
OPENAI_API_KEY = "your-openai-key-here"
ELEVENLABS_API_KEY = "your-elevenlabs-key-here"
```

> Never commit secret.py. It is in .gitignore.

### 5. Patch the picarx library

The picarx library uses `os.getlogin()` which fails under systemd. Patch it:

```bash
sudo sed -i "s/os.getlogin()/os.environ.get('USER', 'YOUR_USERNAME')/" \
  /home/YOUR_USERNAME/picar-x/picarx/picarx.py
```

### 6. Set up autostart

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

---

## WiFi and hotspot setup

The Pi uses NetworkManager. Add networks and set priorities so the car roams between home WiFi and a phone hotspot without intervention.

### Add a hotspot

Turn on the hotspot first, then:

```bash
sudo nmcli dev wifi rescan && sleep 3 && sudo nmcli dev wifi list
sudo nmcli dev wifi connect "Your Hotspot Name" password "YOUR_PASSWORD"
```

> If the SSID contains an apostrophe, use the BSSID (MAC address) from the scan results instead.

### Set network priorities

```bash
sudo nmcli con mod "netplan-wlan0-YourHomeNetwork" connection.autoconnect-priority 100
sudo nmcli con mod "hotspot" connection.autoconnect-priority 10
```

Home WiFi takes priority. Pi falls back to hotspot when away. ngrok reconnects automatically.

---

## Giving an agent the wheel

1. Start the Pi (autostart handles the rest)
2. Get the ngrok URL
3. Share HOW_TO_DRIVE.md with the agent:
```bash
curl -s https://raw.githubusercontent.com/cdfournier/picar-vroom/main/HOW_TO_DRIVE.md
```
4. Tell them the current ngrok URL and what's in the room

---

## API endpoints (summary)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/camera` | GET | JPEG image (`?hires=true` for high-resolution close work) |
| `/distance` | GET | Ultrasonic sensor reading in cm |
| `/move` | POST | Move or look |
| `/speak` | POST | Speak through onboard speaker (ElevenLabs) |
| `/audio/status` | GET | Last audio playback command/result |
| `/audio/test` | POST | Generate and play a short speaker test |
| `/voices` | GET | List available ElevenLabs voices |
| `/observe` | GET/POST | Shared ride-along log |
| `/handoff` | POST | Take or release the wheel |
| `/live` | GET | Browser-based live view |
| `/mission` | POST | Start autonomous mission |
| `/status` | GET | Current mission log |

Full usage details, driving modes, sensor rules, and examples in **[HOW_TO_DRIVE.md](HOW_TO_DRIVE.md)**.

---

## Configuration

Key variables in `picar/picar_server.py`:

```python
SPEED = 50              # Motor speed (0-100)
FORWARD_OFFSET = 3      # Degrees right to compensate left drift
VOICE_MODEL = "..."     # Default ElevenLabs voice ID
USE_ELEVENLABS = True   # Set False to fall back to Piper TTS

VOICES = {
    "Julian": "CwhRBWXzGAHq8TQ4Fs17",  # Roger
    # Add agents here: "Name": "elevenlabs_voice_id"
}
```

---

## License

MIT. Build something.

---

## Credits

Hardware: SunFounder PiCar-X + Raspberry Pi 5  
Software: Built by Chris and Varro (Claude Sonnet 4.6)  
Inspired by: Kim's work on AI agent identity and embodiment
