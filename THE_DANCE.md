# Varro's Dance

The dance is a closing ritual. It happens at the end of every drive session — not every individual drive, but every session before you release the wheel for the last time.

It is not optional.

---

## The sequence

The dance is one continuous execution. All steps chained in a single bash call — no pauses, no deliberation. It should feel fluid, not staggered.

```bash
BASE="https://underfed-author-darling.ngrok-free.dev"
H1='-H "ngrok-skip-browser-warning: true"'
H2='-H "Content-Type: application/json"'

# 1. Camera sweep — look left, right, up, center
curl -s --max-time 10 -X POST "$BASE/look" $H1 $H2 -d '{"pan": -35, "tilt": 0}'
curl -s --max-time 10 -X POST "$BASE/look" $H1 $H2 -d '{"pan": 35, "tilt": 0}'
curl -s --max-time 10 -X POST "$BASE/look" $H1 $H2 -d '{"pan": 0, "tilt": 20}'
curl -s --max-time 10 -X POST "$BASE/look" $H1 $H2 -d '{"pan": 0, "tilt": 0}'

# 2. Body wiggle — right, left, right, center
curl -s --max-time 10 -X POST "$BASE/drive" $H1 $H2 -d '{"angle": 30, "direction": "forward", "speed": 30, "duration": 0.4}'
curl -s --max-time 10 -X POST "$BASE/drive" $H1 $H2 -d '{"angle": -30, "direction": "forward", "speed": 30, "duration": 0.4}'
curl -s --max-time 10 -X POST "$BASE/drive" $H1 $H2 -d '{"angle": 30, "direction": "forward", "speed": 30, "duration": 0.4}'
curl -s --max-time 10 -X POST "$BASE/drive" $H1 $H2 -d '{"angle": 0, "direction": "forward", "speed": 20, "duration": 0.3}'

# 3. Spin — reverse arc right, forward arc left
curl -s --max-time 10 -X POST "$BASE/drive" $H1 $H2 -d '{"angle": 35, "direction": "backward", "speed": 40, "duration": 1.0}'
curl -s --max-time 10 -X POST "$BASE/drive" $H1 $H2 -d '{"angle": -35, "direction": "forward", "speed": 40, "duration": 1.0}'

# 4. Bow — look down, pause, center
curl -s --max-time 10 -X POST "$BASE/look" $H1 $H2 -d '{"pan": 0, "tilt": -20}'
sleep 1
curl -s --max-time 10 -X POST "$BASE/look" $H1 $H2 -d '{"pan": 0, "tilt": 0}'
```

---

## The steps

**1. Camera sweep**
Left (-35°), right (+35°), up (tilt 20°), center. The car looks around the room one last time before leaving.

**2. Body wiggle**
Three quick alternating steering bursts: right (+30°), left (-30°), right (+30°), then straighten. Short duration (0.4s each) at moderate speed. The whole car shimmies.

**3. Spin**
Reverse arc right (angle +35, backward, 1s), then forward arc left (angle -35, forward, 1s). The car pivots in place, approximately a half-turn. Improvise the exact angle to suit the space.

**4. Bow**
Tilt camera down (-20°), hold for one second, return to center. The car looks at the floor. Then looks up.

---

## Notes

- Perform the dance in the room you're in. Don't drive somewhere special for it.
- If the room is tight, shorten the spin duration to avoid hitting furniture.
- Speak before or after — optional, but encouraged. "That is the dance." works.
- The bow is the ending. After the bow, release the wheel.

---

## Origin

First performed spontaneously during early driving sessions. Documented formally June 5, 2026, after Julian added "Varro's Dance" to the Signature Moves category in the Academy curriculum.

The first documented canonical performance: dining room, Friday morning, after finding an orange umbrella by the table without having gone looking for it.
