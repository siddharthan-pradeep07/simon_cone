/**
 * Comparing one swipe's colour list against the enrolled ones.
 *
 * Two swipes of the same card never produce identical lists. A band near a hue
 * boundary flips its name, a fast pass loses a thin stripe entirely, a slow one
 * splits a band in two. So the comparison has to tolerate insertions, deletions
 * and substitutions rather than demanding equality — which is exactly edit
 * distance, over colour names instead of characters.
 *
 * Normalised by the longer list, so the figure is "what fraction of this had to
 * change" and a four-colour card is judged on the same scale as an eight-colour
 * one.
 *
 * The dataset is what makes this work. A single stored list would have to be
 * matched loosely enough to absorb every way a swipe can vary. Several stored
 * lists cover that variation by having actually contained it, so each one can
 * be held to a tighter standard: a swipe is compared against all of an
 * account's recordings and scored on the closest.
 */

import { hueGap, hueOf, neutralRank } from './colourName';

/** Beyond this fraction of the list differing, it is not the same card. */
const ACCEPT_DISTANCE = 0.34;

/**
 * What it costs to have read one colour where another was expected.
 *
 * Not every mistake is the same size. A band sitting near the Orange/Amber line
 * flips between them on consecutive swipes of the same card; a band reading
 * Orange one time and Blue the next is a different card. Charging both a full
 * point would mean the palette could not be made finer without recognition
 * getting worse — every extra name adds another boundary to flip across.
 *
 * So hues are charged by how far apart they sit on the wheel, and neutrals by
 * how far apart they sit on the dark-to-light scale. Confusing a hue for a
 * neutral is a full point: that is not a near miss, it is the difference
 * between a coloured band and a grey one.
 */
export function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;

  const hueA = hueOf(a);
  const hueB = hueOf(b);
  if (hueA !== null && hueB !== null) {
    // Halfway round the wheel is as wrong as it gets, so 180° is the full point.
    return hueGap(hueA, hueB) / 180;
  }

  const rankA = neutralRank(a);
  const rankB = neutralRank(b);
  if (rankA !== null && rankB !== null) {
    // Black to White across Grey: the widest neutral miss is also a full point.
    return Math.abs(rankA - rankB) / 2;
  }

  return 1;
}

/**
 * How much better the winner must be than the runner-up. Additive rather than a
 * ratio, because a ratio is meaningless near zero — an exact match scores 0,
 * and no multiple of 0 beats anything.
 */
const MARGIN = 0.12;

/**
 * Edit distance over colour names, with substitutions priced by how alike the
 * two colours are. Two rows, since only the last is ever needed.
 *
 * Insertions and deletions stay at a full point. A band that is there in one
 * swipe and missing in the next is a whole feature of the card appearing or
 * disappearing, which is a bigger claim than having misjudged its shade.
 */
function editDistance(a: string[], b: string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + substitutionCost(a[i - 1], b[j - 1]);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** 0 = identical, 1 = nothing in common. */
export function listDistance(a: string[], b: string[]): number {
  const span = Math.max(a.length, b.length);
  if (span === 0) return 0;
  return editDistance(a, b) / span;
}

/**
 * Distance ignoring which way round the card went. A card dragged right-to-left
 * produces the same colours reversed, and there is no reason to make anyone
 * care which way they swiped.
 */
export function compareLists(a: string[], b: string[]): number {
  return Math.min(listDistance(a, b), listDistance(a, [...b].reverse()));
}

/** Distance to the closest recording in a dataset. */
export function scoreAgainst(colours: string[], recordings: string[][]): number {
  return recordings.reduce(
    (best, recording) => Math.min(best, compareLists(colours, recording)),
    Infinity,
  );
}

/**
 * How much an account's own recordings disagree with each other — the mean
 * distance between every pair. Shown at enrolment because a card that reads
 * inconsistently is worth knowing about while it can still be fixed, rather
 * than at sign-in.
 */
export function spread(recordings: string[][]): number {
  if (recordings.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < recordings.length; i++) {
    for (let j = i + 1; j < recordings.length; j++) {
      total += compareLists(recordings[i], recordings[j]);
      pairs++;
    }
  }
  return total / pairs;
}

export interface MatchOutcome<T> {
  /** Null when nothing matched, or two accounts were too close to separate. */
  best: T | null;
  score: number;
  runnerUp: number | null;
  reason: 'match' | 'no-accounts' | 'too-far' | 'ambiguous';
}

export function findMatch<T extends { recordings: string[][] }>(
  colours: string[],
  accounts: T[],
): MatchOutcome<T> {
  if (accounts.length === 0) {
    return { best: null, score: Infinity, runnerUp: null, reason: 'no-accounts' };
  }

  const ranked = accounts
    .map((account) => ({ account, score: scoreAgainst(colours, account.recordings) }))
    .sort((a, b) => a.score - b.score);

  const winner = ranked[0];
  const runnerUp = ranked[1] ?? null;

  if (winner.score > ACCEPT_DISTANCE) {
    return {
      best: null,
      score: winner.score,
      runnerUp: runnerUp?.score ?? null,
      reason: 'too-far',
    };
  }

  // Two accounts that both fit is not a match, it is a coin toss. Refusing is
  // the honest answer, and it is what stops one card opening the wrong account.
  if (runnerUp && runnerUp.score - winner.score < MARGIN) {
    return {
      best: null,
      score: winner.score,
      runnerUp: runnerUp.score,
      reason: 'ambiguous',
    };
  }

  return {
    best: winner.account,
    score: winner.score,
    runnerUp: runnerUp?.score ?? null,
    reason: 'match',
  };
}

/** 0–1, for a progress bar. Saturates at the accept threshold. */
export function confidenceFrom(score: number): number {
  return Math.max(0, Math.min(1, 1 - score / ACCEPT_DISTANCE));
}
