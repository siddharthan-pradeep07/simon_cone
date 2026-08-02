/**
 * Sound, synthesised rather than downloaded.
 *
 * Every effect here is a couple of oscillators and an envelope, which for
 * blips, whooshes and sweeps is both smaller than the files would be and
 * easier to tune — the lane-change note is literally the lane index, so the
 * three lanes are audibly three different pitches without anyone having to
 * record three samples.
 *
 * Browsers refuse to start an AudioContext until the user has interacted with
 * the page, so the context is created lazily on the first sound the player
 * themselves caused. Building it up front produces a suspended context and a
 * console warning on every load.
 */

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function audio(): { context: AudioContext; master: GainNode } | null {
  if (!context) {
    const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    context = new Constructor();
    master = context.createGain();
    master.gain.value = 0.28;
    master.connect(context.destination);
  }
  // A context created before a gesture, or one suspended by a background tab,
  // has to be nudged back awake or every sound is silently dropped.
  if (context.state === 'suspended') void context.resume();
  return master ? { context, master } : null;
}

export function setMuted(next: boolean) {
  muted = next;
  if (master && context) {
    master.gain.setTargetAtTime(next ? 0 : 0.28, context.currentTime, 0.02);
  }
}

interface ToneOptions {
  from: number;
  to?: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

function tone({ from, to = from, duration, type = 'sine', gain = 1, delay = 0 }: ToneOptions) {
  const bus = audio();
  if (!bus || muted) return;
  const start = bus.context.currentTime + delay;

  const oscillator = bus.context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, start);
  if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);

  // A short attack rather than an instant one: switching a gain node straight
  // to full produces a click at the discontinuity, on every single note.
  const envelope = bus.context.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, duration * 0.3));
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(envelope).connect(bus.master);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** Filtered white noise — the body of anything that is a whoosh rather than a note. */
function noise(duration: number, from: number, to: number, gain = 0.5, delay = 0) {
  const bus = audio();
  if (!bus || muted) return;
  const start = bus.context.currentTime + delay;

  const frames = Math.floor(bus.context.sampleRate * duration);
  const buffer = bus.context.createBuffer(1, frames, bus.context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < frames; index++) samples[index] = Math.random() * 2 - 1;

  const source = bus.context.createBufferSource();
  source.buffer = buffer;

  const filter = bus.context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + duration);

  const envelope = bus.context.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + duration * 0.25);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter).connect(envelope).connect(bus.master);
  source.start(start);
}

export const sound = {
  /** Any button. Short and dry, so holding a rapid conversation with the UI is not irritating. */
  click: () => {
    tone({ from: 620, to: 880, duration: 0.07, type: 'triangle', gain: 0.5 });
  },

  /** The cone leaving the ground. */
  launch: () => {
    noise(0.75, 300, 2600, 0.32);
    tone({ from: 180, to: 720, duration: 0.7, type: 'sawtooth', gain: 0.18 });
    tone({ from: 360, to: 1440, duration: 0.7, type: 'sine', gain: 0.16 });
  },

  /** Control handed over. */
  go: () => {
    tone({ from: 660, duration: 0.1, type: 'square', gain: 0.32 });
    tone({ from: 990, duration: 0.22, type: 'square', gain: 0.32, delay: 0.1 });
  },

  /** Changing lane. Pitched by lane, so the three colours sound like three things. */
  swap: (lane: number) => {
    const notes = [523.25, 659.25, 783.99];
    tone({ from: notes[lane] ?? 659.25, duration: 0.16, type: 'triangle', gain: 0.45 });
    noise(0.18, 900, 2400, 0.14);
  },

  /**
   * Hitting a car. A crack of noise sweeping downward for the blast, under it
   * a pitch dropping through the floor for the weight, and a low rumble
   * arriving a beat late — an explosion you hear the size of before you hear
   * the end of.
   */
  crash: () => {
    noise(0.5, 4200, 260, 0.65);
    noise(0.9, 700, 60, 0.4, 0.04);
    tone({ from: 180, to: 32, duration: 0.75, type: 'sawtooth', gain: 0.3 });
    tone({ from: 90, to: 28, duration: 1, type: 'sine', gain: 0.34, delay: 0.03 });
  },

  /** End of a run. */
  over: () => {
    tone({ from: 520, to: 160, duration: 0.55, type: 'sawtooth', gain: 0.24 });
    tone({ from: 260, to: 80, duration: 0.6, type: 'sine', gain: 0.22 });
  },
};
