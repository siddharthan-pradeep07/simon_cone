import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sample } from './protocol';

/**
 * Turns the colour sensor into a three-position switch.
 *
 * The board streams raw photodiode counts about 125 times a second. Those
 * counts are not a colour: they carry how bright the room is, how close the
 * card is held, and how the sensor's own channels differ in sensitivity, all
 * mixed together. Three steps take each of those out.
 *
 *   Brightness and distance -> chromaticity, r/(r+g+b). Moving the card closer
 *     scales all three channels together, so dividing by their sum cancels it.
 *
 *   The sensor's own bias -> subtract a calibrated neutral. A TCS34725 looking
 *     at white paper does not read a third in each channel; it leans green.
 *     Without this, white reads as a lane and the cone drifts on its own.
 *
 *   Noise and the moment of the swap -> smooth, then require the answer to hold
 *     still before acting on it. Colours smear into each other while a card is
 *     being moved into place, and committing to what the sensor saw mid-motion
 *     makes the cone twitch through a lane it was never meant to visit.
 *
 * What is left is which of the three channels is furthest above neutral, which
 * is exactly the question the game is asking.
 */

/** Below this the sensor is looking at the dark, not at a colour. */
const MIN_CLEAR = 14;

/** How far above neutral a channel must sit to count as that colour. */
const MIN_DEVIATION = 0.022;

/** Milliseconds a reading has to hold before the cone moves. */
const HOLD_MS = 70;

/** Weight of each new sample in the running average. */
const SMOOTHING = 0.25;

const BASELINE_KEY = 'simon-cone:white-balance';

export interface Chromaticity {
  r: number;
  g: number;
  b: number;
}

const NEUTRAL: Chromaticity = { r: 1 / 3, g: 1 / 3, b: 1 / 3 };

export interface ColourReading {
  /** Which lane the sensor is currently seeing, or null for neutral or dark. */
  lane: number | null;
  /** Smoothed chromaticity, for showing the player what the board can see. */
  chroma: Chromaticity;
  /** 0–1, how far past the threshold the winning channel is. */
  strength: number;
  /** Raw clear channel, so a dead sensor is distinguishable from a dark one. */
  clear: number;
}

const BLANK: ColourReading = { lane: null, chroma: NEUTRAL, strength: 0, clear: 0 };

function loadBaseline(): Chromaticity {
  try {
    const stored = JSON.parse(localStorage.getItem(BASELINE_KEY) ?? 'null');
    if (stored && typeof stored.r === 'number') return stored as Chromaticity;
  } catch {
    /* nothing stored, or stored by an older version */
  }
  return NEUTRAL;
}

export function useColourLane(onLane: (lane: number) => void) {
  const [reading, setReading] = useState<ColourReading>(BLANK);
  const [baseline, setBaseline] = useState<Chromaticity>(loadBaseline);

  const smoothed = useRef<Chromaticity | null>(null);
  const candidate = useRef<{ lane: number | null; since: number }>({ lane: null, since: 0 });
  const committed = useRef<number | null>(null);
  const live = useRef<ColourReading>(BLANK);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const onLaneRef = useRef(onLane);
  onLaneRef.current = onLane;

  const feed = useCallback((sample: Sample) => {
    const total = sample.r + sample.g + sample.b;

    if (total <= 0 || sample.c < MIN_CLEAR) {
      smoothed.current = null;
      candidate.current = { lane: null, since: 0 };
      live.current = { ...BLANK, clear: sample.c };
      return;
    }

    const next: Chromaticity = {
      r: sample.r / total,
      g: sample.g / total,
      b: sample.b / total,
    };

    const previous = smoothed.current ?? next;
    const chroma: Chromaticity = {
      r: previous.r + (next.r - previous.r) * SMOOTHING,
      g: previous.g + (next.g - previous.g) * SMOOTHING,
      b: previous.b + (next.b - previous.b) * SMOOTHING,
    };
    smoothed.current = chroma;

    // Because chromaticity and the baseline both sum to one, these deviations
    // sum to zero — so the largest of them is already the winning channel and
    // there is nothing more to normalise.
    const white = baselineRef.current;
    const deviation = [chroma.r - white.r, chroma.g - white.g, chroma.b - white.b];

    let lane = 0;
    for (let index = 1; index < 3; index++) {
      if (deviation[index] > deviation[lane]) lane = index;
    }
    const margin = deviation[lane];
    const seen = margin >= MIN_DEVIATION ? lane : null;

    live.current = {
      lane: seen,
      chroma,
      strength: Math.min(1, margin / (MIN_DEVIATION * 3)),
      clear: sample.c,
    };

    // The board's own clock, so a stall in the browser cannot be mistaken for
    // the card having been held steady.
    if (candidate.current.lane !== seen) {
      candidate.current = { lane: seen, since: sample.t };
      return;
    }
    if (seen === null || seen === committed.current) return;
    if (sample.t - candidate.current.since < HOLD_MS) return;

    committed.current = seen;
    onLaneRef.current(seen);
  }, []);

  // The reading exists to be drawn. Pushing it at sensor rate would re-render
  // the HUD 125 times a second to move a bar by a pixel.
  useEffect(() => {
    const timer = window.setInterval(() => setReading(live.current), 60);
    return () => window.clearInterval(timer);
  }, []);

  const calibrate = useCallback(() => {
    const chroma = smoothed.current;
    if (!chroma) return false;
    localStorage.setItem(BASELINE_KEY, JSON.stringify(chroma));
    setBaseline(chroma);
    committed.current = null;
    return true;
  }, []);

  const resetCalibration = useCallback(() => {
    localStorage.removeItem(BASELINE_KEY);
    setBaseline(NEUTRAL);
  }, []);

  const reset = useCallback(() => {
    smoothed.current = null;
    candidate.current = { lane: null, since: 0 };
    committed.current = null;
  }, []);

  return { feed, reading, calibrate, resetCalibration, reset, baseline };
}
