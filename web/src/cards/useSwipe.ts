/**
 * Finds swipes in the sample stream.
 *
 * The board streams continuously and has no idea when a card is present. That
 * decision is made here, from the clear channel: a card entering the gap
 * reflects the illuminator straight back, so the level jumps well above what
 * empty air returns.
 *
 * The threshold is relative to a baseline that tracks ambient light while
 * nothing is there, rather than a fixed number. Room lighting, the gate's
 * shadow and the sensor's own gain all move the idle level, and a constant
 * would need retuning for every one of them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FULL_SCALE, type Sample } from '../serial/protocol';

/** Multiple of baseline that counts as a card arriving. */
const ENTER_RATIO = 1.6;
/** Absolute margin too, so a near-black baseline cannot trigger on noise. */
const ENTER_FLOOR = 45;
/** Lower bar to leave than to enter — hysteresis, or the edges would chatter. */
const EXIT_RATIO = 1.25;

/** Never let one swipe run away with the buffer. */
const MAX_SAMPLES = 500;

/** How fast the idle baseline follows the room. */
const BASELINE_ALPHA = 0.02;

/**
 * One captured swipe, numbered. The sequence number is what lets a page
 * consume a capture exactly once — the object identity alone would re-fire on
 * any unrelated re-render.
 */
export interface CapturedSwipe {
  seq: number;
  signature: number[] | null;
  samples: number;
  durationMs: number;
}

export interface SwipeMeter {
  level: number;
  baseline: number;
  present: boolean;
  /** The clear channel hit full scale — chromaticity is unreliable. */
  clipped: boolean;
}

export function useSwipe(onSwipe: (samples: Sample[]) => void) {
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  const baseline = useRef(0);
  const buffer = useRef<Sample[]>([]);
  const active = useRef(false);
  const live = useRef<SwipeMeter>({
    level: 0,
    baseline: 0,
    present: false,
    clipped: false,
  });
  const [meter, setMeter] = useState<SwipeMeter>(live.current);

  const feed = useCallback((sample: Sample) => {
    live.current.level = sample.c;
    if (sample.c >= FULL_SCALE - 4) live.current.clipped = true;

    if (!active.current) {
      if (sample.c > baseline.current * ENTER_RATIO + ENTER_FLOOR) {
        active.current = true;
        live.current.clipped = false;
        buffer.current = [sample];
      } else {
        // Only adapt while idle. Letting the baseline chase the card would
        // erase the very step being detected.
        baseline.current =
          baseline.current === 0
            ? sample.c
            : baseline.current + BASELINE_ALPHA * (sample.c - baseline.current);
        live.current.baseline = baseline.current;
      }
    } else if (
      sample.c < baseline.current * EXIT_RATIO + ENTER_FLOOR / 2 ||
      buffer.current.length >= MAX_SAMPLES
    ) {
      // Ends on the sample *before* this one: the reading that fell back to
      // baseline is the gap after the card, not part of it.
      const captured = buffer.current;
      active.current = false;
      buffer.current = [];
      onSwipeRef.current(captured);
    } else {
      buffer.current.push(sample);
    }

    live.current.present = active.current;
  }, []);

  const reset = useCallback(() => {
    baseline.current = 0;
    buffer.current = [];
    active.current = false;
    live.current = { level: 0, baseline: 0, present: false, clipped: false };
    setMeter(live.current);
  }, []);

  // Samples land 125 times a second; nothing on screen needs that. Publishing
  // on a timer keeps the meter live without re-rendering per sample.
  useEffect(() => {
    const timer = window.setInterval(() => setMeter({ ...live.current }), 80);
    return () => window.clearInterval(timer);
  }, []);

  return { feed, reset, meter };
}
