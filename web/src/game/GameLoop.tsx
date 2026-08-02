import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  CAMERA_GAME,
  CAMERA_MENU,
  INTRO_DURATION,
  LANES,
  LANE_DAMPING,
  LANE_STIFFNESS,
  MENU_DRIFT,
  UNITS_PER_POINT,
} from './constants';
import { runtime, useGame } from './store';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const range = (value: number, from: number, to: number) => clamp01((value - from) / (to - from));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const approach = (current: number, target: number, rate: number, delta: number) =>
  current + (target - current) * (1 - Math.exp(-rate * delta));

/**
 * Advances the world. Mounted first inside the canvas so that everything which
 * reads `runtime` this frame is reading numbers that have already been stepped.
 */
export function GameLoop() {
  const scoreClock = useRef(0);

  useFrame((_, rawDelta) => {
    // A tab that was backgrounded comes back with a delta of several seconds.
    // Uncapped, that teleports the cone through the world in one step.
    const delta = Math.min(rawDelta, 0.05);
    const game = useGame.getState();

    if (game.phase === 'intro') {
      runtime.intro = Math.min(1, runtime.intro + delta / INTRO_DURATION);
      runtime.worldBlend = mix(MENU_DRIFT, 1, smoothstep(range(runtime.intro, 0.4, 1)));
      if (runtime.intro >= 1) game.beginRun();
    } else if (game.phase === 'playing') {
      runtime.worldBlend = 1;

      // Only under power does the lane spring drive the cone; during the menu
      // and the launch the animation owns its position and writes back.
      const targetX = LANES[runtime.targetLane].x;
      const force = (targetX - runtime.x) * LANE_STIFFNESS - runtime.vx * LANE_DAMPING;
      runtime.vx += force * delta;
      runtime.x += runtime.vx * delta;
    } else {
      runtime.worldBlend = approach(runtime.worldBlend, MENU_DRIFT, 2.5, delta);
    }

    runtime.distance += runtime.speed * runtime.worldBlend * delta;

    scoreClock.current += delta;
    if (game.phase === 'playing' && scoreClock.current > 0.06) {
      scoreClock.current = 0;
      game.setScore(Math.floor(runtime.distance / UNITS_PER_POINT));
    }
  });

  return null;
}

/**
 * One camera, two poses, and a blend between them. The title screen and the
 * game are the same shot from different places, which is why the transition
 * can be a move rather than a cut.
 */
export function CameraRig() {
  const blend = useRef(0);
  const look = useMemo(() => new Vector3(), []);
  const sway = useRef(0);

  useFrame(({ camera }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const phase = useGame.getState().phase;

    const wanted =
      phase === 'playing' ? 1 : phase === 'intro' ? smoothstep(range(runtime.intro, 0.05, 0.92)) : 0;
    blend.current = approach(blend.current, wanted, 7, delta);
    const t = blend.current;

    // The camera drifts sideways with the cone, but only part of the way, so a
    // lane change still reads as the cone moving rather than the world sliding.
    sway.current = approach(sway.current, runtime.x * 0.32 * t, 6, delta);

    camera.position.set(
      mix(CAMERA_MENU.position[0], CAMERA_GAME.position[0], t) + sway.current,
      mix(CAMERA_MENU.position[1], CAMERA_GAME.position[1], t),
      mix(CAMERA_MENU.position[2], CAMERA_GAME.position[2], t),
    );

    look.set(
      mix(CAMERA_MENU.target[0], CAMERA_GAME.target[0], t) + sway.current * 0.55,
      mix(CAMERA_MENU.target[1], CAMERA_GAME.target[1], t),
      mix(CAMERA_MENU.target[2], CAMERA_GAME.target[2], t),
    );
    camera.lookAt(look);

    // A slightly wider lens once the run is underway, to open the road out.
    const perspective = camera as PerspectiveCamera;
    const fov = mix(50, 58, t);
    if (Math.abs(perspective.fov - fov) > 0.01) {
      perspective.fov = fov;
      perspective.updateProjectionMatrix();
    }
  });

  return null;
}
