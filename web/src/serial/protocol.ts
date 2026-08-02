/**
 * Wire protocol shared with src/main.cpp.
 *
 * Newline-delimited text over USB serial at 115200 baud. Plain `VERB ARG ARG`
 * rather than JSON: parsing JSON on an ATmega328P is expensive and the board
 * has 2 KB of RAM to work with.
 */

export const BAUD_RATE = 115200;

/** One raw reading, exactly as the photodiodes measured it. */
export interface Sample {
  /** The board's own millis(), not arrival time. */
  t: number;
  r: number;
  g: number;
  b: number;
  /** Clear channel — total light reaching the sensor. */
  c: number;
}

/** Full scale for the clear channel at the firmware's 2.4 ms integration. */
export const FULL_SCALE = 1024;

export interface Config {
  /** The board is streaming samples. */
  scanning: boolean;
  led: boolean;
  /** 0=1x, 1=4x, 2=16x, 3=60x. */
  gain: number;
}

export const DEFAULT_CONFIG: Config = {
  scanning: false,
  led: true,
  gain: 2,
};

export type HardwareEvent =
  | { type: 'ready'; version: string }
  | { type: 'pong' }
  | { type: 'ok'; command: string }
  | { type: 'error'; message: string }
  | { type: 'freeram'; bytes: number }
  | { type: 'config'; config: Config }
  | { type: 'sample'; sample: Sample }
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
    case 'FREERAM':
      return { type: 'freeram', bytes: Number(rest[0]) };
    case 'CFG':
      return {
        type: 'config',
        config: {
          scanning: rest[0] === '1',
          led: rest[1] === '1',
          gain: Number(rest[2]),
        },
      };
    // Single letter on purpose: this arrives ~125 times a second and the verb
    // is pure overhead on every sample.
    case 'S': {
      const [t, r, g, b, c] = rest.map(Number);
      return { type: 'sample', sample: { t, r, g, b, c } };
    }
    default:
      return { type: 'unknown', line };
  }
}

export const command = {
  ping: () => 'PING',
  oled: (text: string) => `OLED ${text}`,
  clear: () => 'CLEAR',
  scan: (on: boolean) => `SCAN ${on ? 1 : 0}`,
  led: (on: boolean) => `LED ${on ? 1 : 0}`,
  gain: (index: number) => `GAIN ${Math.round(index)}`,
};
