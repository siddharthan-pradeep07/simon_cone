import { useCallback, useEffect, useRef, useState } from 'react';
import { FULL_SCALE, type Sample } from './protocol';

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
 *   The sensor's own bias -> divide by a calibrated neutral. A TCS34725 looking
 *     at white paper does not read a third in each channel; it leans green.
 *     Without this, white reads as a lane and the cone drifts on its own.
 *
 *   Infrared bleed -> remove the estimate from ams DN40 before either step.
 *     The unfiltered sensor leaks infrared mainly into red; without correcting
 *     it, dark blue objects can be pulled toward the red lane.
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

/** At the ADC ceiling the channel ratios are no longer trustworthy. */
const MAX_CLEAR = FULL_SCALE * 0.98;

/** Below this channel spread the reading is grey/white, not a lane colour. */
const MIN_SATURATION = 0.14;

/** Milliseconds a reading has to hold before the cone moves. */
const HOLD_MS = 70;

/** Weight of each new sample in the running average. */
const SMOOTHING = 0.25;

// v2 baselines are captured after IR removal. Reusing a v1 value (captured
// from raw channels) would apply the old red bias a second time.
const BASELINE_KEY = 'simon-cone:white-balance:v2';

export interface Chromaticity {
  r: number;
  g: number;
  b: number;
}

const NEUTRAL: Chromaticity = { r: 1 / 3, g: 1 / 3, b: 1 / 3 };

/** Shortest distance around the hue wheel, in degrees. */
const hueGap = (a: number, b: number) => {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
};

/**
 * Maps a balanced chromaticity to the nearest of the game's three primaries.
 *
 * Dividing by the calibrated white point corrects the sensor/illuminator bias.
 * Hue then makes "nearest" literal: red is 0°, green 120°, blue 240°. This
 * behaves sensibly for in-between cards too (cyan is equally close to green
 * and blue) instead of merely choosing whichever raw photodiode count won.
 */
export function nearestLane(
  chroma: Chromaticity,
  white: Chromaticity = NEUTRAL,
): { lane: number | null; strength: number } {
  const r = chroma.r / Math.max(white.r, 0.001);
  const g = chroma.g / Math.max(white.g, 0.001);
  const b = chroma.b / Math.max(white.b, 0.001);
  const peak = Math.max(r, g, b);
  const floor = Math.min(r, g, b);
  const delta = peak - floor;
  const saturation = peak > 0 ? delta / peak : 0;
  if (!Number.isFinite(saturation) || saturation < MIN_SATURATION) {
    return { lane: null, strength: 0 };
  }

  let hue: number;
  if (peak === r) hue = (60 * (g - b)) / delta;
  else if (peak === g) hue = (60 * (b - r)) / delta + 120;
  else hue = (60 * (r - g)) / delta + 240;
  if (hue < 0) hue += 360;

  const centres = [0, 120, 240];
  let lane = 0;
  for (let index = 1; index < centres.length; index++) {
    if (hueGap(hue, centres[index]) < hueGap(hue, centres[lane])) lane = index;
  }
  return { lane, strength: Math.min(1, saturation) };
}

/**
 * TCS34725 infrared correction from ams application note DN40. Infrared leaks
 * mostly into red; removing it before chromaticity stops dark blue objects
 * being pulled toward the red lane.
 */
function removeInfrared(sample: Sample) {
  const sum = sample.r + sample.g + sample.b;
  const infrared = sum > sample.c ? (sum - sample.c) / 2 : 0;
  return {
    r: Math.max(0, sample.r - infrared),
    g: Math.max(0, sample.g - infrared),
    b: Math.max(0, sample.b - infrared),
  };
}

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
    const corrected = removeInfrared(sample);
    const total = corrected.r + corrected.g + corrected.b;

    if (
      total <= 0 ||
      sample.c < MIN_CLEAR ||
      sample.c >= MAX_CLEAR ||
      ![sample.r, sample.g, sample.b, sample.c, sample.t].every(Number.isFinite)
    ) {
      smoothed.current = null;
      candidate.current = { lane: null, since: 0 };
      committed.current = null;
      live.current = { ...BLANK, clear: sample.c };
      return;
    }

    const next: Chromaticity = {
      r: corrected.r / total,
      g: corrected.g / total,
      b: corrected.b / total,
    };

    const previous = smoothed.current ?? next;
    const chroma: Chromaticity = {
      r: previous.r + (next.r - previous.r) * SMOOTHING,
      g: previous.g + (next.g - previous.g) * SMOOTHING,
      b: previous.b + (next.b - previous.b) * SMOOTHING,
    };
    smoothed.current = chroma;

    const white = baselineRef.current;
    const nearest = nearestLane(chroma, white);
    const seen = nearest.lane;

    live.current = {
      lane: seen,
      chroma,
      strength: nearest.strength,
      clear: sample.c,
    };

    // The board's own clock, so a stall in the browser cannot be mistaken for
    // the card having been held steady.
    if (candidate.current.lane !== seen) {
      candidate.current = { lane: seen, since: sample.t };
      return;
    }
    if (seen === null) {
      // A real release re-arms the same colour. Without this, red -> neutral
      // -> red calls onLane only once; that breaks after play() resets the cone
      // to the centre while the hook still remembers red as committed.
      if (sample.t - candidate.current.since >= HOLD_MS) committed.current = null;
      return;
    }
    if (seen === committed.current) return;
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
