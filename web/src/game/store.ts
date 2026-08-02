import { create } from 'zustand';
import { setMuted, sound } from './audio';
import { MUTED_KEY, SPEED_START, START_LANE } from './constants';

export type Phase = 'menu' | 'intro' | 'playing' | 'over';

/**
 * Per-frame values live here rather than in React state. The cone's position
 * changes sixty times a second and nothing in the DOM needs to know about it;
 * routing that through a store would re-render the whole tree for a number the
 * renderer already has.
 */
export const runtime = {
  /** How much of the launch sequence has played, 0–1. */
  intro: 0,
  speed: SPEED_START,
  /** Total distance travelled this run. */
  distance: 0,
  /** The lane the cone is heading for. */
  targetLane: START_LANE,
  /** Where the cone actually is, and how fast it is sliding sideways. */
  x: 0,
  vx: 0,
  /** Height above the road, for the contact shadow to size itself against. */
  height: 1,
  /** How much of the game's speed the world is running at: 0 idle, 1 full. */
  worldBlend: 0,
  /**
   * Whether the eyes and smile should be drawn. Owned by the cone's animation,
   * which is the only thing that knows how far through a tumble it is, and
   * read by the face — the face is not welded to a phase because a phase can
   * change while the cone is still halfway through turning over.
   */
  showFace: true,
};

export function resetRuntime() {
  runtime.intro = 0;
  runtime.speed = SPEED_START;
  runtime.distance = 0;
  runtime.targetLane = START_LANE;
  runtime.x = 0;
  runtime.vx = 0;
  runtime.height = 1;
}

interface GameState {
  phase: Phase;
  /** Mirrors runtime.targetLane for the parts of the UI that draw it. */
  lane: number;
  /** Rounded, and only pushed a few times a second. */
  score: number;
  muted: boolean;
  /** True once the sensor is driving the lane instead of the keyboard. */
  sensorLive: boolean;

  play: () => void;
  beginRun: () => void;
  endRun: () => void;
  toMenu: () => void;
  setLane: (lane: number) => void;
  setScore: (score: number) => void;
  toggleMute: () => void;
  setSensorLive: (live: boolean) => void;
}

export const useGame = create<GameState>((set, get) => ({
  phase: 'menu',
  lane: START_LANE,
  score: 0,
  muted: localStorage.getItem(MUTED_KEY) === '1',
  sensorLive: false,

  play: () => {
    if (get().phase !== 'menu' && get().phase !== 'over') return;
    resetRuntime();
    sound.launch();
    set({ phase: 'intro', lane: START_LANE, score: 0 });
  },

  beginRun: () => {
    sound.go();
    set({ phase: 'playing' });
  },

  endRun: () => {
    if (get().phase !== 'playing') return;
    sound.crash();
    sound.over();
    set({ phase: 'over' });
  },

  toMenu: () => {
    resetRuntime();
    set({ phase: 'menu', lane: START_LANE, score: 0 });
  },

  setLane: (lane) => {
    const clamped = Math.max(0, Math.min(2, lane));
    runtime.targetLane = clamped;
    if (get().lane === clamped) return;
    // Only when the game is actually running: the sensor keeps reporting on
    // the title screen and a menu that chirps at whatever is on the desk is
    // not a feature.
    if (get().phase === 'playing') sound.swap(clamped);
    set({ lane: clamped });
  },

  setScore: (score) => {
    if (get().score !== score) set({ score });
  },

  toggleMute: () =>
    set((state) => {
      const muted = !state.muted;
      localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
      setMuted(muted);
      return { muted };
    }),

  setSensorLive: (sensorLive) => set({ sensorLive }),
}));

setMuted(useGame.getState().muted);
