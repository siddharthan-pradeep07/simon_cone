# simon_cone — optical card reader

A card is identified by the sequence of colours along it. Enrol a card ten
times, then swipe it to sign in.

```
npm install
npm run dev     # http://localhost:5173
```

Chrome, Edge or Opera on desktop only — Firefox and Safari do not implement the
Web Serial API. Close the PlatformIO serial monitor first; only one process can
hold the port.

## Split

The board is dumb I/O: it opens a servo gate over the sensor, streams raw
readings, and draws whatever text it is sent. Every decision about what a swipe
*is* — where it starts and ends, how it becomes a signature, whether it matches
an enrolled card — happens in the browser, where it can change without a
reflash.

Accounts live in `localStorage`. There is no server.

## Wire protocol

Newline-delimited text at 115200 baud. Mirrored in `src/serial/protocol.ts` and
`../src/main.cpp` — change both together.

| Browser → board | Effect |
| --- | --- |
| `PING` | replies `PONG` |
| `OLED <text>` | draws text; `\|` is a line break, font auto-fits |
| `CLEAR` | blanks the panel |
| `GATE <0\|1>` | servo shutter over the sensor |
| `SWIPE <0\|1>` | start/stop the sample stream |
| `LED <0\|1>` | sensor illuminator |
| `GAIN <0-3>` | 1x, 4x, 16x, 60x |
| `SERVO <1-3> <0-180>` | absolute angle, for setting the gate positions |

| Board → browser | Meaning |
| --- | --- |
| `READY <version>` | sent once after boot |
| `CFG <gate> <swipe> <led> <gain>` | current state, after any change |
| `FREERAM <bytes>` | heap headroom, printed every boot. Watch it — see below |
| `S <ms> <r> <g> <b> <c>` | raw sample, ~125 Hz while swiping |
| `ERR <reason>` | bad command or missing sensor |

Samples carry the board's own `millis()` rather than being timed on arrival:
USB CDC delivers in bursts, so several samples can land in one packet
microseconds apart.

## Matching

Two swipes of the same card differ in speed, duration, height and direction.
Each step of `src/cards/signature.ts` removes one of them:

- **speed, duration** — resample onto 24 bins spread evenly across the swipe
- **height, lighting** — convert to chromaticity, `r/(r+g+b)`, which cancels any
  scaling common to all three channels
- **direction** — also compare against the reversed signature, keep the better

Ten enrolment swipes give both the template (their average) and the tolerance
(how much they disagreed). Matching scores in units of that spread, so a card
that reads consistently is held to a tight standard and a noisy one is given
room. A match that is not clearly better than the runner-up is refused rather
than guessed.

This is a card recogniser, not a security credential: it reads what is visible
on the card, there is no secret involved, and a similar-looking card will match.

## Hardware

| Pin | Device |
| --- | --- |
| A4 / A5 | I²C — SSD1306 OLED and TCS34725 |
| D9 | gate servo |

Gate angles are `GATE_OPEN_DEG` / `GATE_CLOSED_DEG` in `../src/main.cpp`.

## RAM

The ATmega328P has 2 KB and the SSD1306 framebuffer `malloc`s 1 KB of it at
runtime, which the linker's "RAM used" figure does not show. Overshoot and
`display.begin()` simply fails. `FREERAM` on every boot is the real number;
if it approaches ~100 bytes, expect symptoms that look like anything except a
memory problem. `platformio.ini` already trims the serial TX buffer to buy
headroom back.
