/**
 * Putting a name to what the sensor is looking at.
 *
 * This is the whole of the recognition system now: a colour shown to the reader
 * becomes a word, and a sequence of words is the credential. Two corrections
 * stand between the raw photodiode counts and a word that means anything.
 *
 * Infrared. The TCS34725 has no IR filter and infrared leaks mostly into the
 * red channel. The clear channel sees colour plus infrared while r+g+b sees
 * colour twice, so their difference estimates the infrared content (ams
 * application note DN40).
 *
 * White balance. Even after that, an empty sensor on this board reads r=33
 * g=28 b=24 — a solid 30 degree hue, which names as Orange. That warmth is the
 * illuminator LED's spectrum and the sensor's own per-channel response. Both
 * are constant, which is exactly what a white point is for: rescale so the
 * background comes out neutral and everything else falls into place.
 */

/** A reading of all four channels, with no timestamp. */
export interface Reading {
  r: number;
  g: number;
  b: number;
  c: number;
}

export interface NamedColour {
  name: string;
  /** Roughly what the sensor is seeing, for a swatch. */
  css: string;
}

/** Below this there is not enough light to call it anything. */
const DARK = 20;

/** Channel spread below this fraction of the peak is grey, not a hue. */
const NEUTRAL_SATURATION = 0.14;

/** Below this a white-point channel is noise and scaling by it would explode. */
const WHITE_FLOOR = 6;

/**
 * The hue names, each with the angle it sits at.
 *
 * A reading takes the name whose angle it is closest to, so the buckets are
 * defined by their centres rather than by boundaries — which is what lets the
 * matcher ask "how far apart are these two names?" and charge less for
 * confusing Orange with Amber than Orange with Blue. Boundaries alone could not
 * answer that.
 *
 * Fifteen of them, averaging 24° apart. That is about as fine as this sensor
 * justifies: after white balance it resolves hue to roughly ±10-15°, so
 * narrower buckets would mostly record which side of a line the noise fell on.
 * Names are the common ones on purpose — someone reading "Vermilion" off the
 * screen cannot check it against the card in their hand.
 */
export const HUES: ReadonlyArray<{ name: string; hue: number }> = [
  { name: 'Red', hue: 0 },
  { name: 'Orange', hue: 25 },
  { name: 'Amber', hue: 45 },
  { name: 'Yellow', hue: 60 },
  { name: 'Lime', hue: 85 },
  { name: 'Green', hue: 120 },
  { name: 'Mint', hue: 155 },
  { name: 'Cyan', hue: 180 },
  { name: 'Azure', hue: 205 },
  { name: 'Blue', hue: 235 },
  { name: 'Indigo', hue: 262 },
  { name: 'Violet', hue: 285 },
  { name: 'Purple', hue: 305 },
  { name: 'Magenta', hue: 325 },
  { name: 'Pink', hue: 345 },
];

/**
 * The neutrals, ordered dark to light. Ranked rather than listed so the matcher
 * can treat Grey-for-White as a near miss the same way it treats Orange for
 * Amber — it is the same kind of mistake, made on brightness instead of hue.
 */
export const NEUTRALS: ReadonlyArray<string> = ['Black', 'Grey', 'White'];

/** Every name a swipe can contain. */
export const COLOURS: ReadonlyArray<string> = [
  ...HUES.map((entry) => entry.name),
  ...NEUTRALS,
];

const HUE_BY_NAME = new Map(HUES.map((entry) => [entry.name, entry.hue]));

/** The angle a hue name sits at, or null if it is not a hue. */
export function hueOf(name: string): number | null {
  return HUE_BY_NAME.get(name) ?? null;
}

/** Where a neutral sits on the dark-to-light scale, or null if it is not one. */
export function neutralRank(name: string): number | null {
  const index = NEUTRALS.indexOf(name);
  return index === -1 ? null : index;
}

/** Shortest way round the colour wheel between two angles, 0–180. */
export function hueGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function nameForHue(hue: number): string {
  let best = HUES[0];
  let bestGap = 360;
  for (const entry of HUES) {
    const gap = hueGap(hue, entry.hue);
    if (gap < bestGap) {
      bestGap = gap;
      best = entry;
    }
  }
  return best.name;
}

/**
 * Not a colour anyone chose to show — the empty sensor, or too little light to
 * judge. Never captured into a sequence.
 */
export const BACKGROUND = 'Dark';

/** Subtracts the infrared bleed, per ams DN40. */
function deIr(r: number, g: number, b: number, c: number) {
  const sum = r + g + b;
  const ir = sum > c ? (sum - c) / 2 : 0;
  return [Math.max(0, r - ir), Math.max(0, g - ir), Math.max(0, b - ir)] as const;
}

/** Rescales so the given white point would come out exactly neutral. */
function balance(r: number, g: number, b: number, white?: Reading) {
  if (!white) return [r, g, b] as const;

  const [wr, wg, wb] = deIr(white.r, white.g, white.b, white.c);
  if (wr < WHITE_FLOOR || wg < WHITE_FLOOR || wb < WHITE_FLOOR) {
    // Sensor in the dark, or no baseline settled yet. Naming raw is wrong but
    // inventing a scale factor out of noise is worse.
    return [r, g, b] as const;
  }

  // Scale about the white point's own mean, so the overall level is preserved
  // and only the balance between the channels moves.
  const mean = (wr + wg + wb) / 3;
  return [r * (mean / wr), g * (mean / wg), b * (mean / wb)] as const;
}

export function colourName(
  r: number,
  g: number,
  b: number,
  c: number,
  white?: Reading,
): NamedColour {
  if (c < DARK) return { name: BACKGROUND, css: '#1c1917' };

  const [irR, irG, irB] = deIr(r, g, b, c);
  const [cr, cg, cb] = balance(irR, irG, irB, white);

  const peak = Math.max(cr, cg, cb);
  const floor = Math.min(cr, cg, cb);
  if (peak <= 0) return { name: BACKGROUND, css: '#1c1917' };

  const css = `rgb(${Math.round((cr / peak) * 255)}, ${Math.round(
    (cg / peak) * 255,
  )}, ${Math.round((cb / peak) * 255)})`;

  if ((peak - floor) / peak < NEUTRAL_SATURATION) {
    // Neutral: the only thing left to say is how bright it is. The split is
    // against the sensor's own range, not an absolute, because gain moves it.
    if (c > 600) return { name: 'White', css };
    if (c > 120) return { name: 'Grey', css };
    return { name: 'Black', css };
  }

  // Hue as a ratio of channel differences — the standard formula, folded so it
  // stays in one expression.
  const delta = peak - floor;
  let hue: number;
  if (peak === cr) hue = (60 * (cg - cb)) / delta;
  else if (peak === cg) hue = (60 * (cb - cr)) / delta + 120;
  else hue = (60 * (cr - cg)) / delta + 240;
  if (hue < 0) hue += 360;

  return { name: nameForHue(hue), css };
}

/**
 * A swatch for a colour known only by name — for redrawing a stored dataset,
 * where the original reading is long gone.
 *
 * Generated from the hue's own angle rather than hand-picked, so a name can
 * never drift out of step with the swatch beside it when the table changes.
 * Fixed saturation and lightness: chromaticity has no brightness left in it, so
 * hue is genuinely all there is to draw.
 */
export function cssForName(name: string): string {
  switch (name) {
    case 'White':
      return '#f5f5f4';
    case 'Grey':
      return '#a8a29e';
    case 'Black':
      return '#292524';
    default: {
      const hue = hueOf(name);
      return hue === null ? '#1c1917' : `hsl(${hue} 78% 55%)`;
    }
  }
}
