# simon_cone — web bridge

Dev console for the Arduino side of the project. The board owns no game logic:
it reports its inputs over USB serial and executes commands from this page.

```
npm install
npm run dev     # http://localhost:5173
```

Chrome, Edge or Opera on desktop only — Firefox and Safari do not implement the
Web Serial API. Close the PlatformIO serial monitor first; only one process can
hold the port.

## Wire protocol

Newline-delimited text at 115200 baud. Mirrored in `src/serial/protocol.ts` and
`../src/main.cpp` — change both together.

| Browser → board | Effect |
| --- | --- |
| `PING` | replies `PONG` |
| `OLED <text>` | draws text, wrapped, size 2 if ≤ 20 chars |
| `CLEAR` | blanks the panel |
| `LED <0\|1>` | pin 13, the onboard "L" |
| `SENSORLED <0\|1>` | TCS34725 white illuminator |
| `DISPLAY <0\|1>` | OLED panel power (text is retained) |
| `ALLOFF` / `ALLON` | all three lights at once |
| `SERVO <1-3> <0-180>` | absolute angle |
| `RAW <0\|1>` | toggle raw colour streaming |

| Board → browser | Meaning |
| --- | --- |
| `READY <version>` | sent once after boot |
| `LIGHTS <led> <sensor> <display>` | after boot and after every change |
| `COLOR <name>` | only when the reading changes |
| `RAW <r> <g> <b> <c>` | ~4 Hz while streaming |
| `JOY <UP\|DOWN\|LEFT\|RIGHT>` | one per flick |
| `BTN <DOWN\|UP>` | debounced |
| `ERR <reason>` | bad command or missing sensor |

## Without hardware

Arrow keys emit the same events as the joystick and Enter emits a button press,
so the whole UI is testable with nothing plugged in.
