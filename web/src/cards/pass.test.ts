/**
 * Drives the pass detector and the list matcher with synthetic swipes. Run:
 *
 *   npm test
 *
 * The point is what is miserable to check by hand with a coloured card: that a
 * card crossing the sensor comes out as the colours actually printed on it in
 * the right order, that the smear between two bands is not recorded as a third
 * colour, and that the matcher separates two accounts without also rejecting a
 * card that read slightly differently this time.
 */

import { createPassDetector } from './pass';
import { compareLists, findMatch, listDistance, spread, substitutionCost } from './match';
import { COLOURS, HUES, colourName, cssForName, hueGap } from './colourName';
import type { Sample } from '../serial/protocol';

const SAMPLE_MS = 8;

/** The empty sensor as this board actually reads it — warm, and dim. */
const EMPTY = { r: 33, g: 28, b: 24, c: 71 };

const BANDS: Record<string, { r: number; g: number; b: number; c: number }> = {
  Red: { r: 300, g: 70, b: 60, c: 460 },
  Green: { r: 70, g: 300, b: 80, c: 470 },
  Blue: { r: 60, g: 90, b: 300, c: 470 },
  Yellow: { r: 290, g: 280, b: 70, c: 660 },
};

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

type Detector = ReturnType<typeof createPassDetector>;
type Reading = { r: number; g: number; b: number; c: number };

/** Fully saturated colour at a given angle, as 0-1 channels. */
function hslToRgb(hue: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function blend(a: Reading, b: Reading, t: number): Reading {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    c: a.c + (b.c - a.c) * t,
  };
}

function feed(d: Detector, reading: Reading, count: number, clock: { now: number }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    clock.now += SAMPLE_MS;
    const sample: Sample = { t: clock.now, ...reading };
    const done = d.feed(sample, clock.now);
    if (done) out.push(done);
  }
  return out;
}

/** Lets the baseline lock on to the empty sensor. */
function settle(d: Detector, clock: { now: number }) {
  feed(d, EMPTY, 250, clock);
}

/**
 * A card crossing the sensor: each band held for `perBand` samples, with a few
 * samples of blend between them where the sensor straddles the boundary.
 */
function swipe(
  d: Detector,
  names: string[],
  clock: { now: number },
  perBand = 20,
  smear = 3,
) {
  const done = [];
  for (let i = 0; i < names.length; i++) {
    if (i > 0) {
      for (let s = 1; s <= smear; s++) {
        done.push(
          ...feed(d, blend(BANDS[names[i - 1]], BANDS[names[i]], s / (smear + 1)), 1, clock),
        );
      }
    }
    done.push(...feed(d, BANDS[names[i]], perBand, clock));
  }
  // Card leaves; the release dwell ends the swipe.
  done.push(...feed(d, EMPTY, 40, clock));
  return done;
}

console.log('a card crossing the sensor reads as its bands in order');
{
  const clock = { now: 0 };
  const d = createPassDetector();
  settle(d, clock);

  const done = swipe(d, ['Red', 'Green', 'Blue'], clock);
  check('one swipe detected', done.length, 1);
  check('colours in order', done[0]?.colours, ['Red', 'Green', 'Blue']);
  check('no problem reported', done[0]?.problem, null);
}

console.log('a repeated colour along the card is kept');
{
  const clock = { now: 0 };
  const d = createPassDetector();
  settle(d, clock);

  // Red, Green, Red -- the second Red must not be merged into the first.
  const done = swipe(d, ['Red', 'Green', 'Red'], clock);
  check('three bands', done[0]?.colours, ['Red', 'Green', 'Red']);
}

console.log('the smear between two bands is not recorded as a third colour');
{
  const clock = { now: 0 };
  const d = createPassDetector();
  settle(d, clock);

  // A long blend between Red and Blue passes through Purple on the way.
  const done = swipe(d, ['Red', 'Blue'], clock, 30, 6);
  check('only the two real bands', done[0]?.colours, ['Red', 'Blue']);
}

console.log('two swipes of the same card do not have to be identical');
{
  const clock = { now: 0 };
  const d = createPassDetector();
  settle(d, clock);

  const fast = swipe(d, ['Red', 'Green', 'Blue'], clock, 14)[0];
  feed(d, EMPTY, 120, clock);
  const slow = swipe(d, ['Red', 'Green', 'Blue'], clock, 40)[0];

  check('both readable', [fast?.problem, slow?.problem], [null, null]);
  check('and they agree', compareLists(fast!.colours, slow!.colours), 0);
}

console.log('a swipe too short to read says so');
{
  const clock = { now: 0 };
  const d = createPassDetector();
  settle(d, clock);

  // A knock: present for a handful of samples, then gone.
  const done = feed(d, BANDS.Red, 5, clock).concat(feed(d, EMPTY, 40, clock));
  check('reported as a swipe', done.length, 1);
  check('with a problem', typeof done[0]?.problem, 'string');
}

console.log('direction does not matter');
{
  check('a list equals its own reverse', compareLists(['Red', 'Green', 'Blue'], ['Blue', 'Green', 'Red']), 0);
}

console.log('list distance behaves');
{
  check('identical', listDistance(['Red', 'Blue'], ['Red', 'Blue']), 0);
  check('one insertion in four', listDistance(
    ['Red', 'Blue', 'Green'],
    ['Red', 'Blue', 'Yellow', 'Green'],
  ), 0.25);
  check('opposite hues are a full point', listDistance(['Red'], ['Cyan']), 1);
}

console.log('the palette is fine but neighbouring hues are cheap to confuse');
{
  check('every hue name is distinct', new Set(HUES.map((h) => h.name)).size, HUES.length);
  check('and the palette is worth having', HUES.length >= 12, true);

  // Every gap has to be wide enough that the sensor is not just recording which
  // side of a line its noise fell on.
  const gaps = HUES.map((entry, index) =>
    hueGap(entry.hue, HUES[(index + 1) % HUES.length].hue),
  );
  check('no two hues sit closer than 15 degrees', Math.min(...gaps) >= 15, true);

  check('a colour costs nothing against itself', substitutionCost('Orange', 'Orange'), 0);
  const neighbour = substitutionCost('Orange', 'Amber');
  const distant = substitutionCost('Orange', 'Blue');
  check('neighbours are cheap', neighbour < 0.2, true);
  check('distant hues are expensive', distant > 0.8, true);
  // The ratio is what matters: a boundary flip has to be worth a small fraction
  // of a real difference, or the finer palette costs more than it gives.
  check('and the gap between them is wide', distant / neighbour > 5, true);
  check(
    'a hue read as a neutral is a full miss',
    substitutionCost('Orange', 'Grey'),
    1,
  );
  check('adjacent neutrals are cheap', substitutionCost('White', 'Grey'), 0.5);

  // This is the property the whole scheme rests on: making the palette finer
  // must not make the same card stop matching itself.
  const enrolled = [['Red', 'Amber', 'Green', 'Azure']];
  const drifted = ['Orange', 'Yellow', 'Lime', 'Blue']; // every band off by one
  check(
    'a swipe that drifts one bucket on every band still matches',
    findMatch(drifted, [{ recordings: enrolled }]).reason,
    'match',
  );
  check(
    'but a genuinely different card does not',
    findMatch(['Violet', 'Pink', 'Cyan', 'Yellow'], [{ recordings: enrolled }]).reason,
    'too-far',
  );
}

console.log('every name the reader can produce can be drawn');
{
  const undrawable = COLOURS.filter((name) => cssForName(name) === '#1c1917');
  check('all names have a swatch', undrawable, []);

  // Sweep the wheel and confirm the reader actually reaches every hue -- a name
  // in the table that no reading can produce would be dead weight.
  const produced = new Set<string>();
  for (let hue = 0; hue < 360; hue += 1) {
    const [r, g, b] = hslToRgb(hue);
    // Scaled well clear of the dark and neutral cutoffs, and fed its own
    // reading as the white point so no balance is applied.
    produced.add(colourName(r * 400, g * 400, b * 400, 900).name);
  }
  check(
    'every hue name is reachable',
    HUES.map((h) => h.name).filter((name) => !produced.has(name)),
    [],
  );
}

console.log('spread measures how much a dataset disagrees with itself');
{
  check('a consistent dataset', spread([
    ['Red', 'Green'],
    ['Red', 'Green'],
    ['Red', 'Green'],
  ]), 0);
  check('a noisy one is above zero', spread([
    ['Red', 'Green'],
    ['Red', 'Blue'],
    ['Yellow', 'Green'],
  ]) > 0, true);
}

console.log('matching picks the right account and refuses when unsure');
{
  const alex = {
    name: 'alex',
    recordings: [
      ['Red', 'Green', 'Blue'],
      ['Red', 'Green', 'Blue'],
      ['Red', 'Green', 'Cyan'],
    ],
  };
  const sam = {
    name: 'sam',
    recordings: [
      ['Yellow', 'Purple'],
      ['Yellow', 'Purple'],
      ['Orange', 'Purple'],
    ],
  };

  check('exact swipe matches', findMatch(['Red', 'Green', 'Blue'], [alex, sam]).best?.name, 'alex');
  check('the other card', findMatch(['Yellow', 'Purple'], [alex, sam]).best?.name, 'sam');
  check(
    'a swipe covered by the dataset still matches',
    findMatch(['Red', 'Green', 'Cyan'], [alex, sam]).best?.name,
    'alex',
  );
  check(
    'one band misread out of three is tolerated',
    findMatch(['Red', 'Green', 'Purple'], [alex, sam]).best?.name,
    'alex',
  );
  check(
    'an unknown card is refused',
    findMatch(['Pink', 'White', 'Black'], [alex, sam]).reason,
    'too-far',
  );
  check('no accounts', findMatch(['Red'], []).reason, 'no-accounts');

  // Two accounts enrolled with the same card cannot be separated, and guessing
  // would silently sign into the wrong one.
  const twin = { name: 'twin', recordings: [['Red', 'Green', 'Blue']] };
  check(
    'a tie is refused rather than guessed',
    findMatch(['Red', 'Green', 'Blue'], [alex, twin]).reason,
    'ambiguous',
  );
}

console.log('');
if (failures > 0) {
  // Thrown rather than process.exit(1): this file is typechecked with the app,
  // which has DOM types and no node types, and throwing fails the run just as
  // well without dragging @types/node in for one line.
  throw new Error(`${failures} failing check(s)`);
}
console.log('all checks passed');
