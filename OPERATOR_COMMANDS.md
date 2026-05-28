# PiCar Operator Quick Reference

## Starting the car

The Pi auto-starts on power-up. Just plug it in and wait ~15 seconds.

If you need to start or restart manually:
```bash
sudo systemctl start picar-server.service
sudo systemctl start picar-ngrok.service
```

Or restart both:
```bash
sudo systemctl restart picar-server.service && sudo systemctl restart picar-ngrok.service
```

---

## Checking status

```bash
sudo systemctl status picar-server.service
sudo systemctl status picar-ngrok.service
```

---

## Shutting down

```bash
sudo shutdown now
```

## Rebooting

```bash
sudo reboot
```

---

## Pulling latest code from GitHub

```bash
cd ~/picar-x && git pull varro main
sudo systemctl restart picar-server.service
```

---

## Testing from Mac terminal

```bash
# Check car is live
curl -s "https://underfed-author-darling.ngrok-free.dev/status" \
  -H "ngrok-skip-browser-warning: true"

# Test distance sensor
curl -s "https://underfed-author-darling.ngrok-free.dev/distance" \
  -H "ngrok-skip-browser-warning: true"

# Test voice
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/speak" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"text": "Hello.", "voice": "Varro"}'

# Move forward 2 seconds
curl -s -X POST "https://underfed-author-darling.ngrok-free.dev/move" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{"action": "forward", "duration": 2.0}'
```

---

## Current ngrok URL
```
https://underfed-author-darling.ngrok-free.dev
```
*(Reserved free domain — stable across restarts)*

---

## Live view (phone or browser)
```
https://underfed-author-darling.ngrok-free.dev/live
```
Includes: camera feed, observe log, operator text chat, push-to-talk microphone. Name saved in browser localStorage.

---

## Giving an agent the wheel

Paste this into their session:

1. Read the driving manual:
```bash
curl -s https://raw.githubusercontent.com/cdfournier/picar-vroom/main/HOW_TO_DRIVE.md
```

2. Verify the car is live:
```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/distance" \
  -H "ngrok-skip-browser-warning: true"
```

3. Tell them: the ngrok URL, what's in the room, and that they're free to explore.

---

## If audio stops working

Check the service file has all four Environment lines:
```bash
cat /etc/systemd/system/picar-server.service
```

Should include:
```
Environment=LOGNAME=chris
Environment=SDL_AUDIODRIVER=alsa
Environment=AUDIODEV=hw:sndrpihifiberry
Environment=PICAR_AUDIO_PLAYER=mpg123
```

If missing, add them and run:
```bash
sudo systemctl daemon-reload && sudo systemctl restart picar-server.service
```

---

## If camera drops after restart

```bash
sudo systemctl restart picar-server.service
```

It comes back.

