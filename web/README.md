# simon_cone — optical card reader

Move a card or picture across the sensor. One swipe records every colour along
it, in order. Five swipes make the account's dataset; signing in takes a single
swipe, and if the reader cannot tell which account it is, you just swipe again.

The dataset is the whole point. Two swipes of the same card never read
identically — a band near a hue boundary flips its name, a fast pass loses a
thin stripe. One stored list would have to be matched loosely enough to absorb
all of that. Several cover the variation by having contained it, so a single
sign-in swipe can be held to a tight standard.

```
npm install
npm run dev     # http://localhost:5173
npm test        # the pass detector and the matcher
```

Chrome, Edge or Opera on desktop only — Firefox and Safari do not implement the
Web Serial API. Close the PlatformIO serial monitor first; only one process can
hold the port.

## Split

The board is dumb I/O: it streams raw readings and draws whatever text it is
sent. Every decision — what colour this is, whether it counts, when to take it —
happens in the browser, where it can change without a reflash.

Accounts live in `localStorage`. There is no server.

## Finding a swipe

`src/cards/pass.ts`. The board streams continuously and has no idea when
something is in front of the sensor, so the start and end are decided here.

"Did it get brighter?" is not enough — a dark card over a dark sensor barely
moves the clear channel, and something passing under strong room light can make
the reading *fall*. What reliably happens either way is that the colour changes.
So novelty is measured two ways and either one starts a swipe: relative change
in the clear channel, and chromaticity distance, which catches something a
different colour at the same brightness.

A swipe ends after 8 consecutive quiet samples. The dwell matters: a card often
has a plain band across the middle that reads like the empty slot, and without
it one card would be chopped into two or three swipes.

Two things are deliberately kept out of the colour list:

- **quiet samples** — the gap after the card has left, and any band that matches
  the background. Naming them would give every swipe the same phantom colour on
  the end.
- **short runs** — under 6% of the swipe, the sensor was caught between two
  bands reading a blend of both. A long Red-to-Blue transition passes through
  Purple, and Purple is not on the card.

The detector takes `now` as an argument and holds no clock of its own, so
`npm test` can drive it with synthetic swipes at any speed instead of someone
waving a card in real time.

## Matching

`src/cards/match.ts`. Two swipes of the same card differ by an insertion, a
deletion or a substitution, which is exactly edit distance — over colour names
instead of characters, normalised by the longer list so a four-colour card is
judged on the same scale as an eight-colour one.

Substitutions are priced by how alike the two colours are (see the palette,
above). Insertions and deletions stay at a full point: a band that is there in
one swipe and missing in the next is a whole feature of the card appearing or
disappearing, which is a bigger claim than having misjudged its shade.

A swipe is compared against every recording in an account's dataset and scored
on the closest. It is also compared against each recording reversed, so it does
not matter which way round the card went.

A match beyond 34% different is refused. So is one that is not at least 0.12
clear of the runner-up — two accounts that both fit is not a match, it is a coin
toss, and refusing is what stops one card opening the wrong account. The margin
is additive rather than a ratio because a ratio is meaningless near zero: an
exact match scores 0, and no multiple of 0 beats anything.

## Naming

`src/cards/colourName.ts` is the whole recognition system. Two corrections sit
between raw photodiode counts and a word:

- **infrared** — the TCS34725 has no IR filter and infrared lands mostly in red.
  The clear channel sees colour plus IR while `r+g+b` sees colour twice, so
  their difference estimates the IR to subtract (ams application note DN40).
- **white balance** — even after that, an empty sensor on this board reads
  `r=33 g=28 b=24`, a solid 30° hue, which names as **Orange**. That warmth is
  the illuminator LED's spectrum and the sensor's own per-channel response, both
  constant. Rescaling so the tracked background comes out neutral is what makes
  every other name mean anything.

The baseline only adapts while the sensor is clear, so it follows the room
without chasing the card in front of it, and it freezes for the length of a
swipe.

### The palette

Fifteen hues — Red, Orange, Amber, Yellow, Lime, Green, Mint, Cyan, Azure, Blue,
Indigo, Violet, Purple, Magenta, Pink — plus White, Grey and Black. They are
defined by the angle each sits at rather than by boundaries, and a reading takes
whichever name it is nearest.

Averaging 24° apart is about as fine as this sensor justifies: after white
balance it resolves hue to roughly ±10-15°, so narrower buckets would mostly
record which side of a line the noise fell on.

Defining them by centre is what makes the finer palette safe. Every extra name
adds another boundary for a band to flip across between swipes, so the matcher
prices a substitution by how far apart the two names actually sit — Orange for
Amber costs 0.11, Orange for Blue costs 0.83. A card whose every band drifts one
bucket still matches itself; a genuinely different card still does not. Without
that, making the palette finer would have made recognition worse.

This is a card recogniser, not a security credential: it reads what anyone can
see by looking at the card, there is no secret involved, and a similar-looking
card will match.

## Wire protocol

Newline-delimited text at 115200 baud. Mirrored in `src/serial/protocol.ts` and
`../src/main.cpp` — change both together.

| Browser → board | Effect |
| --- | --- |
| `PING` | replies `PONG` |
| `OLED <text>` | draws text; `\|` is a line break, font auto-fits |
| `CLEAR` | blanks the panel |
| `SCAN <0\|1>` | start/stop the sample stream |
| `LED <0\|1>` | sensor illuminator |
| `GAIN <0-3>` | 1x, 4x, 16x, 60x |

| Board → browser | Meaning |
| --- | --- |
| `READY <version>` | sent once after boot |
| `CFG <scan> <led> <gain>` | current state, after any change |
| `FREERAM <bytes>` | heap headroom, printed every boot. Watch it — see below |
| `S <ms> <r> <g> <b> <c>` | raw sample, ~125 Hz while scanning |
| `ERR <reason>` | bad command or missing sensor |

`SCAN` was called `SWIPE` up to firmware 4. A board still running the old build
answers `ERR unknown command SCAN` and never streams, which looks exactly like a
dead sensor — check `READY` says 5 before believing that.

## Checking the hardware

When it is unclear whether the sensor or the web app is at fault, take the web
app out of it:

```
powershell -File ../tools/colourcheck.ps1 -Port COM10 -Seconds 8
```

It prints the firmware version, the white point, and the colours seen in order —
show it a few colours while it runs. Hit **Disconnect** in the web app first;
only one process can hold the port.

## Hardware

| Pin | Device |
| --- | --- |
| A4 / A5 | I²C — SSD1306 OLED and TCS34725 |

The servo gate is gone — nothing needs to move for the sensor to see a colour
held over it, and a servo holding position only added jitter and current draw.

## RAM

The ATmega328P has 2 KB and the SSD1306 framebuffer `malloc`s 1 KB of it at
runtime, which the linker's "RAM used" figure does not show. Overshoot and
`display.begin()` simply fails. `FREERAM` on every boot is the real number;
if it approaches ~100 bytes, expect symptoms that look like anything except a
memory problem. `platformio.ini` already trims the serial TX buffer to buy
headroom back.
