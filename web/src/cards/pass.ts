/**
 * Finding a swipe in the sample stream, and reading the colours along it.
 *
 * The board streams continuously and has no idea when something is in front of
 * the sensor. That decision is made here, and then the colours found between
 * the start and the end become the swipe.
 *
 * Deciding a swipe has begun cannot just be "did it get brighter?". A dark card
 * over a dark sensor barely moves the clear channel, and something passing
 * under strong room light can make the reading *fall*. What reliably happens
 * either way is that the colour changes: the sensor stops seeing the empty slot
 * and starts seeing whatever is being shown. So novelty is measured two ways
 * and either one starting it is enough:
 *
 *   brightness — relative change in the clear channel, so it behaves the same
 *     at any ambient level rather than needing a threshold per room.
 *
 *   colour — distance in chromaticity, r/(r+g+b). Scale-free, so it catches
 *     something a different colour at the same brightness, which is exactly the
 *     case a brightness test misses.
 *
 * Both compare against a baseline that follows the empty sensor while nothing
 * is there and freezes the moment something is — otherwise it would chase the
 * card and erase the very difference being detected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BACKGROUND, colourName, type NamedColour, type Reading } from './colourName';
import type { Sample } from '../serial/protocol';

/** Relative change in the clear channel that counts as something arriving. */
const BRIGHT_TRIGGER = 0.32;
/** Chromaticity distance that counts on its own, whatever the brightness did. */
const COLOUR_TRIGGER = 0.05;
/** Novelty must fall back under this fraction of the trigger to end a swipe. */
const RELEASE_FRACTION = 0.45;
/**
 * Consecutive quiet samples before a swipe is over. A card often has a plain
 * band across the middle that reads like the empty slot for a few samples;
 * without this dwell one card would be chopped into two or three swipes.
 */
const RELEASE_SAMPLES = 8;

/** Fewer samples than this is a knock or a shadow, not a swipe. */
const MIN_PASS_SAMPLES = 14;
/** Hard stop, so something left sitting on the sensor does not grow forever. */
const MAX_PASS_SAMPLES = 600;

/**
 * A run shorter than this is the sensor caught between two bands, reading a
 * blend of both. Naming that blend invents a colour that is not there. Measured
 * as a fraction of the swipe so it scales with how fast the card went, with an
 * absolute floor for very short swipes.
 */
const MIN_RUN_FRACTION = 0.06;
const MIN_RUN_SAMPLES = 3;

/** Below this the channels are mostly noise and chromaticity means nothing. */
const CHROMA_FLOOR = 22;
/** Guard for the relative-brightness divisor in a near-black slot. */
const BRIGHT_FLOOR = 20;

const BASELINE_ALPHA = 0.03;
const STALE_MS = 600;

export interface CapturedPass {
  /** Every colour found along the swipe, in the order the sensor met them. */
  colours: string[];
  samples: number;
  durationMs: number;
  /** Null when the swipe was too short or too dark to read. */
  problem: string | null;
}

export interface ReaderState {
  /** What is under the sensor right now, or null while it reads as empty. */
  live: NamedColour | null;
  present: boolean;
  /** How far the reading is from the empty sensor. 1.0 triggers a swipe. */
  novelty: number;
  /** Colours found so far in the swipe currently under way. */
  building: string[];
  /** The empty sensor, and the white point everything is named against. */
  white: Reading;
  /** Samples are arriving. False means the board is not streaming. */
  receiving: boolean;
}

const EMPTY: ReaderState = {
  live: null,
  present: false,
  novelty: 0,
  building: [],
  white: { r: 0, g: 0, b: 0, c: 0 },
  receiving: false,
};

function chroma(r: number, g: number, b: number): [number, number, number] {
  const total = r + g + b;
  if (total <= 0) return [1 / 3, 1 / 3, 1 / 3];
  return [r / total, g / total, b / total];
}

interface Run {
  name: string;
  samples: number;
}

/**
 * Drops transition smear, then merges any runs that end up adjacent because
 * something between them was removed.
 */
export function tidyRuns(runs: Run[]): string[] {
  const total = runs.reduce((sum, run) => sum + run.samples, 0);
  const floor = Math.max(MIN_RUN_SAMPLES, Math.round(total * MIN_RUN_FRACTION));
  const kept = runs.filter((run) => run.samples >= floor);
  if (kept.length === 0) return [];

  const merged: string[] = [];
  for (const run of kept) {
    if (merged[merged.length - 1] !== run.name) merged.push(run.name);
  }
  return merged;
}

/**
 * The detector, with no React and no clock of its own — `now` is passed in.
 * Kept separate from the hook so a test can drive it with whatever sample
 * stream is worth checking, rather than only by hand with a coloured card.
 */
export function createPassDetector() {
  let base: Reading | null = null;
  let active = false;
  let quiet = 0;
  let runs: Run[] = [];
  let counted = 0;
  let startedAt = 0;
  let lastAt = 0;
  let live: NamedColour | null = null;
  let present = false;
  let novelty = 0;

  function finish(): CapturedPass {
    const total = counted;
    const durationMs = lastAt - startedAt;
    const colours = tidyRuns(runs);

    active = false;
    quiet = 0;
    runs = [];
    counted = 0;

    let problem: string | null = null;
    if (total < MIN_PASS_SAMPLES) {
      problem = 'That went past too fast to read. Try a slower, steadier pass.';
    } else if (colours.length === 0) {
      problem = 'Nothing held steady long enough to name — too fast, or too dark.';
    }

    return { colours, samples: total, durationMs, problem };
  }

  /** Feeds one sample. Returns a swipe if this sample ended one. */
  function feed(sample: Sample, now: number): CapturedPass | null {
    if (!base) {
      base = { r: sample.r, g: sample.g, b: sample.b, c: sample.c };
      return null;
    }
    const reference = base;

    const brightness =
      Math.abs(sample.c - reference.c) / Math.max(reference.c, BRIGHT_FLOOR);

    let colour = 0;
    if (sample.c >= CHROMA_FLOOR && reference.c >= CHROMA_FLOOR) {
      const a = chroma(sample.r, sample.g, sample.b);
      const b = chroma(reference.r, reference.g, reference.b);
      colour = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }

    novelty = Math.max(brightness / BRIGHT_TRIGGER, colour / COLOUR_TRIGGER);

    const seen = colourName(sample.r, sample.g, sample.b, sample.c, reference);
    live = seen;
    present = active;

    if (!active) {
      if (novelty < 1) {
        // Only adapt while idle, or the baseline would follow the card.
        reference.r += BASELINE_ALPHA * (sample.r - reference.r);
        reference.g += BASELINE_ALPHA * (sample.g - reference.g);
        reference.b += BASELINE_ALPHA * (sample.b - reference.b);
        reference.c += BASELINE_ALPHA * (sample.c - reference.c);
        return null;
      }
      active = true;
      present = true;
      quiet = 0;
      runs = [];
      counted = 0;
      startedAt = now;
    }

    lastAt = now;
    counted++;
    quiet = novelty < RELEASE_FRACTION ? quiet + 1 : 0;

    // Quiet samples read like the empty sensor: the gap after the card has left,
    // or a plain band across the middle that happens to match the background.
    // The dwell keeps the swipe alive through them, but naming them would put a
    // stripe of "background" into the list, and the tail of every single swipe
    // would come out as the same phantom colour.
    //
    // A reading with essentially no light in it names as nothing either.
    if (quiet === 0 && seen.name !== BACKGROUND) {
      const last = runs[runs.length - 1];
      if (last && last.name === seen.name) last.samples++;
      else runs.push({ name: seen.name, samples: 1 });
    }

    if (quiet >= RELEASE_SAMPLES || counted >= MAX_PASS_SAMPLES) return finish();
    return null;
  }

  return {
    feed,
    reset() {
      base = null;
      active = false;
      quiet = 0;
      runs = [];
      counted = 0;
      live = null;
      present = false;
      novelty = 0;
    },
    live: () => live,
    present: () => present,
    novelty: () => novelty,
    white: (): Reading => base ?? { r: 0, g: 0, b: 0, c: 0 },
    building: () => tidyRuns(runs),
  };
}

export function usePassReader(onPass: (pass: CapturedPass) => void) {
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;

  const detector = useRef<ReturnType<typeof createPassDetector> | null>(null);
  detector.current ??= createPassDetector();

  const lastSampleAt = useRef(0);
  const [state, setState] = useState<ReaderState>(EMPTY);

  const feed = useCallback((sample: Sample) => {
    const now = performance.now();
    lastSampleAt.current = now;
    const finished = detector.current!.feed(sample, now);
    if (finished) onPassRef.current(finished);
  }, []);

  const reset = useCallback(() => {
    detector.current!.reset();
    setState(EMPTY);
  }, []);

  // Samples land 125 times a second and nothing on screen needs that. Publishing
  // on a timer keeps the readout live without a re-render per sample.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = detector.current!;
      setState({
        live: d.live(),
        present: d.present(),
        novelty: d.novelty(),
        building: d.building(),
        white: d.white(),
        receiving: performance.now() - lastSampleAt.current < STALE_MS,
      });
    }, 60);
    return () => window.clearInterval(timer);
  }, []);

  return { feed, reset, state };
}
