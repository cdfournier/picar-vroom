# PiCar Operator Quick Reference

## Starting the car

**In VS Code — Pi terminal 1:**
```bash
python3 ~/picar-x/picar_server.py
```

**In VS Code — Pi terminal 2:**
```bash
ngrok http 5000
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

## Testing from Mac terminal

```bash
# Test camera
curl https://underfed-author-darling.ngrok-free.dev/camera -o /dev/null

# Test distance sensor
curl -s "https://underfed-author-darling.ngrok-free.dev/distance" \
  -H "ngrok-skip-browser-warning: true"

# Move forward 2 seconds
curl -X POST https://underfed-author-darling.ngrok-free.dev/move \
  -H "Content-Type: application/json" \
  -d '{"action": "forward", "duration": 2.0}'
```

---

## Current ngrok URL
```
https://underfed-author-darling.ngrok-free.dev
```
*(This is a reserved free domain — should not change on restart)*

---

## Giving an agent the wheel

Paste this into their session:

1. Read the driving manual:
```bash
curl -s https://raw.githubusercontent.com/cdfournier/varro/main/HOW_TO_DRIVE.md
```

2. Verify the car is live:
```bash
curl -s "https://underfed-author-darling.ngrok-free.dev/distance" \
  -H "ngrok-skip-browser-warning: true"
```

3. Tell them: current ngrok URL, what's in the room, and that they're free to explore.
