/**
 * Turning a card swipe into something that can be compared.
 *
 * A card crossing the sensor produces a burst of raw readings. Two swipes of
 * the same card are never identical: they differ in speed, in how long the
 * card was over the window, in height above it, and in direction. A usable
 * descriptor has to be invariant to all four, while still telling two different
 * cards apart. That is the entire problem, and each step below removes exactly
 * one of those degrees of freedom.
 *
 *   Speed and duration -> resample onto a fixed number of bins spread evenly
 *     across the swipe, so a slow swipe and a fast one of the same card land in
 *     the same shape.
 *
 *   Height and lighting -> convert to chromaticity, r/(r+g+b). Moving the card
 *     closer scales all three channels together, so dividing by their sum
 *     cancels it. This is also why the firmware sends raw counts and applies no
 *     corrections: brightness is being divided out here anyway.
 *
 *   Direction -> compare against the reversed signature too and keep whichever
 *     fits better. A card dragged right-to-left produces the mirror image of
 *     the same trace, and there is no reason to make the user care.
 *
 * What is left is the sequence of colours along the card. That is a real
 * physical property of the card and it is what distinguishes one from another.
 *
 * Worth being straight about what this is: a card recogniser, not a security
 * credential. It reads what anyone can see by looking at the card, there is no
 * secret involved, and a similar-looking card will match. It is a good
 * classifier and it is not authentication.
 */

import type { Sample } from '../serial/protocol';

/** Bins across the swipe. 24 keeps the structure of a card's printed bands. */
export const BINS = 24;

/** Fewer samples than this is a knock or a shadow, not a swipe. */
const MIN_SAMPLES = 14;

export interface Template {
  /** Averaged signature across every enrolment swipe. */
  mean: number[];
  /**
   * Mean distance of the enrolment swipes from that average — how consistently
   * this particular card reads. It becomes the yardstick for matching: a card
   * that enrols tightly is held to a tight standard, one that reads noisily is
   * given room. A fixed threshold would be wrong for both.
   */
  spread: number;
}

/**
 * Turns one swipe into a fixed-length descriptor, or null if it was too short
 * to mean anything.
 */
export function extractSignature(samples: Sample[]): number[] | null {
  if (samples.length < MIN_SAMPLES) return null;

  const start = samples[0].t;
  const span = samples[samples.length - 1].t - start;
  if (span <= 0) return null;

  const bins = Array.from({ length: BINS }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  for (const sample of samples) {
    const index = Math.min(BINS - 1, Math.floor(((sample.t - start) / span) * BINS));
    const bin = bins[index];
    bin.r += sample.r;
    bin.g += sample.g;
    bin.b += sample.b;
    bin.n++;
  }

  const signature: number[] = [];
  let previous: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];
  for (const bin of bins) {
    const total = bin.r + bin.g + bin.b;
    if (bin.n === 0 || total <= 0) {
      // A bin can come out empty if the stream stuttered. Carrying the previous
      // value forward is a far smaller lie than a hole reading as neutral grey,
      // which would look like a real feature of the card.
      signature.push(...previous);
      continue;
    }
    previous = [bin.r / total, bin.g / total, bin.b / total];
    signature.push(...previous);
  }
  return signature;
}

/** Root-mean-square difference, so the figure is per-dimension and readable. */
export function distance(a: number[], b: number[]): number {
  let total = 0;
  for (let index = 0; index < a.length; index++) {
    total += (a[index] - b[index]) ** 2;
  }
  return Math.sqrt(total / a.length);
}

/** The same swipe as it would have read in the other direction. */
export function reverse(signature: number[]): number[] {
  const out: number[] = [];
  for (let bin = BINS - 1; bin >= 0; bin--) {
    out.push(signature[bin * 3], signature[bin * 3 + 1], signature[bin * 3 + 2]);
  }
  return out;
}

/** Distance, ignoring which way the card was dragged. */
export function compare(a: number[], b: number[]): number {
  return Math.min(distance(a, b), distance(a, reverse(b)));
}

export function buildTemplate(signatures: number[][]): Template {
  // Orientation has to be settled before averaging. If half the enrolment
  // swipes went one way and half the other, averaging them raw would blend a
  // trace with its own mirror image and produce a template matching neither.
  const reference = signatures[0];
  const aligned = signatures.map((signature) =>
    distance(signature, reference) <= distance(reverse(signature), reference)
      ? signature
      : reverse(signature),
  );

  const mean = reference.map(
    (_, index) =>
      aligned.reduce((total, signature) => total + signature[index], 0) / aligned.length,
  );

  const spread =
    aligned.reduce((total, signature) => total + distance(signature, mean), 0) /
    aligned.length;

  return { mean, spread };
}

/**
 * Floor on the spread. A card that happened to enrol very tightly would
 * otherwise be held to an impossible standard on the next swipe.
 */
const SPREAD_FLOOR = 0.012;

/** Distance in units of the card's own spread, beyond which it is not a match. */
const ACCEPT_SCORE = 3.2;

/** How much better than the runner-up the winner has to be. */
const MARGIN = 1.25;

export interface MatchOutcome<T> {
  /** Null when nothing matched well enough, or two cards were too close. */
  best: T | null;
  score: number;
  runnerUpScore: number | null;
  reason: 'match' | 'no-accounts' | 'too-far' | 'ambiguous';
}

export function findMatch<T extends { template: Template }>(
  signature: number[],
  candidates: T[],
): MatchOutcome<T> {
  if (candidates.length === 0) {
    return { best: null, score: Infinity, runnerUpScore: null, reason: 'no-accounts' };
  }

  // Score in units of each card's own spread rather than raw distance, so a
  // consistently-reading card and a noisy one are judged on the same scale.
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score:
        compare(signature, candidate.template.mean) /
        Math.max(candidate.template.spread, SPREAD_FLOOR),
    }))
    .sort((a, b) => a.score - b.score);

  const winner = ranked[0];
  const runnerUp = ranked[1] ?? null;

  if (winner.score > ACCEPT_SCORE) {
    return {
      best: null,
      score: winner.score,
      runnerUpScore: runnerUp?.score ?? null,
      reason: 'too-far',
    };
  }

  // Two cards that both fit is not a match, it is a coin toss. Refusing is the
  // honest answer and it is what stops one card silently opening two accounts.
  if (runnerUp && winner.score * MARGIN > runnerUp.score) {
    return {
      best: null,
      score: winner.score,
      runnerUpScore: runnerUp.score,
      reason: 'ambiguous',
    };
  }

  return {
    best: winner.candidate,
    score: winner.score,
    runnerUpScore: runnerUp?.score ?? null,
    reason: 'match',
  };
}

/**
 * The signature as visible colour, one block per bin. Normalised to the
 * brightest channel because chromaticity has no brightness left in it — this is
 * the sequence of hues along the card, which is exactly what got stored.
 */
export function swatches(signature: number[]): string[] {
  const out: string[] = [];
  for (let bin = 0; bin < BINS; bin++) {
    const r = signature[bin * 3];
    const g = signature[bin * 3 + 1];
    const b = signature[bin * 3 + 2];
    const peak = Math.max(r, g, b) || 1;
    out.push(
      `rgb(${Math.round((r / peak) * 255)}, ${Math.round((g / peak) * 255)}, ${Math.round(
        (b / peak) * 255,
      )})`,
    );
  }
  return out;
}

/** 0–1, for a progress bar. Saturates at the accept threshold. */
export function confidenceFrom(score: number): number {
  return Math.max(0, Math.min(1, 1 - score / ACCEPT_SCORE));
}
