# PiCar Operator Quick Reference

## Starting the car

The Pi auto-starts on power-up. Just plug it in and wait ~15 seconds.

If you need to start or restart manually:
```bash
sudo systemctl start picar-server.service
sudo systemctl start cloudflared.service
```

Or restart both:
```bash
sudo systemctl restart picar-server.service && sudo systemctl restart cloudflared.service
```

---

## Checking status

```bash
sudo systemctl status picar-server.service
sudo systemctl status cloudflared.service
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
curl -s "https://picar.blackcoffeeshoppe.com/status" \
 

# Test distance sensor
curl -s "https://picar.blackcoffeeshoppe.com/distance" \
 

# Test voice
curl -s -X POST "https://picar.blackcoffeeshoppe.com/speak" \
  -H "Content-Type: application/json" \
  \
  -d '{"text": "Hello.", "voice": "Varro"}'

# Move forward 2 seconds
curl -s -X POST "https://picar.blackcoffeeshoppe.com/move" \
  -H "Content-Type: application/json" \
  \
  -d '{"action": "forward", "duration": 2.0}'
```

---

## Current tunnel URL
```
https://picar.blackcoffeeshoppe.com
```
*(Reserved free domain — stable across restarts)*

---

## Live view (phone or browser)
```
https://picar.blackcoffeeshoppe.com/live
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
curl -s "https://picar.blackcoffeeshoppe.com/distance" \
 
```

3. Tell them: the tunnel URL, what's in the room, and that they're free to explore.

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

