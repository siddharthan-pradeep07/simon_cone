/**
 * The numbers that define the game. Everything tunable lives here so the feel
 * can be adjusted without hunting through the scene graph.
 */

/** Three lanes, three colours. These are also what the sensor looks for. */
export interface Lane {
  index: number;
  name: string;
  /** World X of the lane centre. */
  x: number;
  /** The bright, saturated identity colour — UI, road surface, particles. */
  color: string;
  /** The road surface. Same colour: the lane is the colour, undimmed. */
  surface: string;
  /** What to draw on the board's OLED when this lane is taken. */
  oled: string;
}

export const LANE_WIDTH = 4.6;

export const LANES: Lane[] = [
  {
    index: 0,
    name: 'RED',
    x: -LANE_WIDTH,
    color: '#ff4d6a',
    surface: '#ff4d6a',
    oled: 'RED',
  },
  {
    index: 1,
    name: 'GREEN',
    x: 0,
    color: '#3ddb7f',
    surface: '#3ddb7f',
    oled: 'GREEN',
  },
  {
    index: 2,
    name: 'BLUE',
    x: LANE_WIDTH,
    color: '#4a97ff',
    surface: '#4a97ff',
    oled: 'BLUE',
  },
];

export const START_LANE = 1;

/** Road geometry. Fog hides the far end, so the length is a drawing budget. */
export const ROAD_WIDTH = LANE_WIDTH * 3;
export const ROAD_LENGTH = 200;

/** The apron either side of the road, and the haze it fades into. */
export const GROUND_COLOUR = '#bcb6c9';
export const FOG_COLOUR = '#d3dce8';

/** Forward speed, in world units per second. Constant for the whole run. */
export const SPEED_START = 22;

/** Metres of road per point of score. */
export const UNITS_PER_POINT = 2;

/** Traffic. Cars sit still in a lane and the cone has to go round them. */
export const CAR_MODELS = ['taxi', 'van', 'suv'] as const;

/** How many cars exist at once. They are recycled, never created mid-run. */
export const CAR_POOL = 10;

/** Nose to tail, in world units. Every model is scaled to this. */
export const CAR_LENGTH = 4.6;

/** Where a car is placed, far enough out to still be inside the fog. */
export const CAR_SPAWN_Z = -190;

/** Far enough past the camera that a car is never seen to disappear. */
export const CAR_RETIRE_Z = 26;

/** Road covered between one car and the next. */
export const CAR_GAP_MIN = 38;
export const CAR_GAP_MAX = 62;

/** Half-extents of the box used for hitting a car. Forgiving on purpose. */
export const CAR_HIT_X = 1.7;
export const CAR_HIT_Z = 2.4;

/** Seconds of clear road after the launch before any traffic appears. */
export const CAR_GRACE = 1.6;

/** How hard the cone is pulled toward its lane, and how much it fights back. */
export const LANE_STIFFNESS = 150;
export const LANE_DAMPING = 20;

/** Radians of bank per unit/second of sideways velocity. */
export const LANE_BANK = 0.055;
export const LANE_BANK_MAX = 0.6;

/** The cone's resting height above the road while flying. */
export const CONE_FLY_HEIGHT = 1.15;

/** Seconds the launch sequence takes before control is handed over. */
export const INTRO_DURATION = 2.4;

/** Where the camera sits in each of the two poses it ever takes. */
export const CAMERA_MENU = {
  position: [0, 1.9, 6.2] as const,
  // Aimed above the cone rather than at it, which drops the cone into the
  // lower half of the frame and leaves the top clear for the title.
  target: [0, 1.75, 0] as const,
};

/** Higher and looking further down than a straight chase cam, so the lanes
 *  read as three separate strips rather than converging into one. */
export const CAMERA_GAME = {
  position: [0, 4.5, 7.4] as const,
  target: [0, 0.7, -9] as const,
};

/** Where the cone parks itself on the title screen, standing on the road. */
export const CONE_MENU_POSITION = [-2.35, 1.05, 0] as const;

/**
 * Turned towards its own left on the title screen. It stands left of centre
 * while the camera looks down the middle, so a cone facing straight down +Z is
 * actually showing the player its cheek; this much yaw puts its face on the
 * camera.
 */
export const CONE_MENU_YAW = 0.36;

/** How fast the world drifts behind the title screen. */
export const MENU_DRIFT = 0.22;

export const MUTED_KEY = 'simon-cone:muted';
