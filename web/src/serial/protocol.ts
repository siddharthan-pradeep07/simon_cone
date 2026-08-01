/**
 * Wire protocol shared with src/main.cpp.
 *
 * Newline-delimited text over USB serial at 115200 baud. Keeping it to plain
 * `VERB ARG ARG` rather than JSON matters: parsing JSON on an ATmega328P is
 * expensive and the board has 2 KB of RAM to work with.
 */

export const BAUD_RATE = 115200;

export type JoystickDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** The three independently switchable lights on the rig. */
export interface Lights {
  /** Pin 13, the onboard "L" LED. */
  led: boolean;
  /** The TCS34725's white illuminator. */
  sensor: boolean;
  /** OLED panel power. */
  display: boolean;
}

export type HardwareEvent =
  | { type: 'ready'; version: string }
  | { type: 'pong' }
  | { type: 'ok'; command: string }
  | { type: 'error'; message: string }
  | { type: 'lights'; lights: Lights }
  | { type: 'color'; name: string }
  | { type: 'raw'; r: number; g: number; b: number; c: number }
  | { type: 'joystick'; direction: JoystickDirection }
  | { type: 'button'; pressed: boolean }
  | { type: 'unknown'; line: string };

export function parseLine(line: string): HardwareEvent {
  const [verb, ...rest] = line.trim().split(' ');

  switch (verb) {
    case 'READY':
      return { type: 'ready', version: rest[0] ?? '?' };
    case 'PONG':
      return { type: 'pong' };
    case 'OK':
      return { type: 'ok', command: rest.join(' ') };
    case 'ERR':
      return { type: 'error', message: rest.join(' ') };
    case 'LIGHTS':
      return {
        type: 'lights',
        lights: {
          led: rest[0] === '1',
          sensor: rest[1] === '1',
          display: rest[2] === '1',
        },
      };
    case 'COLOR':
      return { type: 'color', name: rest.join(' ') };
    case 'RAW': {
      const [r, g, b, c] = rest.map(Number);
      return { type: 'raw', r, g, b, c };
    }
    case 'JOY': {
      const direction = rest[0] as JoystickDirection;
      if (['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(direction)) {
        return { type: 'joystick', direction };
      }
      return { type: 'unknown', line };
    }
    case 'BTN':
      return { type: 'button', pressed: rest[0] === 'DOWN' };
    default:
      return { type: 'unknown', line };
  }
}

export const command = {
  ping: () => 'PING',
  oled: (text: string) => `OLED ${text}`,
  clear: () => 'CLEAR',
  led: (on: boolean) => `LED ${on ? 1 : 0}`,
  sensorLed: (on: boolean) => `SENSORLED ${on ? 1 : 0}`,
  display: (on: boolean) => `DISPLAY ${on ? 1 : 0}`,
  allLights: (on: boolean) => (on ? 'ALLON' : 'ALLOFF'),
  servo: (index: 1 | 2 | 3, angle: number) => `SERVO ${index} ${Math.round(angle)}`,
  rawStream: (on: boolean) => `RAW ${on ? 1 : 0}`,
};
