import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Material,
} from 'three';
import {
  CAR_GAP_MAX,
  CAR_GAP_MIN,
  CAR_GRACE,
  CAR_HIT_X,
  CAR_HIT_Z,
  CAR_LENGTH,
  CAR_MODELS,
  CAR_POOL,
  CAR_RETIRE_Z,
  CAR_SPAWN_Z,
  LANES,
} from './constants';
import { runtime, useGame } from './store';
import { makePuffTexture } from './textures';

const MODEL_URLS = CAR_MODELS.map((name) => `/models/cars/${name}.glb`);

/** Share of cars placed directly in the cone's path, forcing a lane change. */
const AIMED_AT_PLAYER = 0.78;

/** Nearer than this and a car is aimed away — there is no time to answer it. */
const REACTION_ROOM = 70;

interface Car {
  node: Group;
  lane: number;
  /** Where the car was placed, in the world's own frame. */
  z: number;
  /** Parked off-screen and not in play. */
  idle: boolean;
}

/**
 * The traffic the cone has to dodge.
 *
 * A fixed pool of cars exists for the whole run and each one is moved back to
 * the horizon once it is behind the camera. Loading a model, compiling its
 * materials and adding it to the scene graph mid-run is exactly the kind of
 * work that drops a frame at the moment the player least wants one, and a
 * runner never needs more than a handful of obstacles in front of them.
 */
export function Traffic() {
  const models = useGLTF(MODEL_URLS);
  const shadowTexture = useMemo(makePuffTexture, []);
  const cars = useRef<Car[]>([]);
  /** Distance at which the next car goes down. */
  const nextAt = useRef(0);
  const wasPlaying = useRef(false);

  const prototypes = useMemo(
    () =>
      models.map((gltf) => {
        const node = gltf.scene.clone(true);

        node.traverse((child) => {
          if (!(child instanceof Mesh)) return;
          // The kit ships physical materials meant for a lit scene, and this
          // scene has no lights at all. Their palette texture carries the
          // entire look, so an unlit material showing that same texture is
          // both correct here and cheaper than what it replaces.
          const source = child.material as Material & Partial<MeshBasicMaterial>;
          child.material = new MeshBasicMaterial({
            map: source.map ?? null,
            color: source.map ? '#ffffff' : (source.color ?? '#cccccc'),
            toneMapped: false,
          });
        });

        // Turned to face the player, then sized and dropped onto the road.
        // Doing this here rather than trusting the export means swapping in a
        // different car is a filename change and nothing else.
        node.rotation.y = Math.PI;
        node.updateMatrixWorld(true);

        const bounds = new Box3().setFromObject(node);
        const size = new Vector3();
        const centre = new Vector3();
        bounds.getSize(size);
        bounds.getCenter(centre);

        // Sized to a common length, centred on its own bounds and dropped onto
        // the road. Doing this from measurement rather than trusting the
        // export is what lets a different car be swapped in as a filename and
        // nothing else — and it is why these sit centred in their lane, which
        // the models are not authored to do on their own.
        const scale = CAR_LENGTH / (size.z || 1);
        node.scale.setScalar(scale);
        node.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);

        // There are no lights and so no cast shadows, but without something
        // dark under it a car reads as hovering a little above the road no
        // matter how exactly its wheels are placed. A blob is enough.
        const shadow = new Mesh(
          new PlaneGeometry(size.x * scale * 1.5, CAR_LENGTH * 1.05),
          new MeshBasicMaterial({
            map: shadowTexture,
            color: '#241733',
            transparent: true,
            opacity: 0.26,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.03;
        shadow.renderOrder = -1;

        // The transform above belongs to the car, not to where it is parked,
        // so it is baked into a wrapper and the outer node is left free for
        // the pool to move around.
        const wrapper = new Group();
        wrapper.add(shadow);
        wrapper.add(node);
        return wrapper;
      }),
    [models, shadowTexture],
  );

  const pool = useMemo<Car[]>(
    () =>
      Array.from({ length: CAR_POOL }, (_, index) => {
        const node = prototypes[index % prototypes.length].clone(true);
        node.visible = false;
        return { node, lane: 1, z: CAR_SPAWN_Z, idle: true };
      }),
    [prototypes],
  );

  cars.current = pool;

  /** Puts one car down at `at` units ahead of wherever the cone is now. */
  function place(at: number) {
    const car = pool.find((entry) => entry.idle);
    if (!car) return;

    // Most cars are put in the lane the cone is in right now.
    //
    // Reading colours to change lane is the entire game, so traffic that lands
    // anywhere else is scenery: the player watches it go by and never touches
    // the sensor. Aimed at them, every car is a question. This is only fair
    // because it is decided the moment the car is placed — a full road's
    // length away, with seconds to answer — and the ones placed too close to
    // react to are aimed away from the player instead.
    const others = [0, 1, 2].filter((lane) => lane !== runtime.targetLane);
    car.lane =
      at >= REACTION_ROOM && Math.random() < AIMED_AT_PLAYER
        ? runtime.targetLane
        : others[Math.floor(Math.random() * others.length)];
    car.z = -at - runtime.distance;
    car.idle = false;
    car.node.visible = true;
  }

  useFrame(() => {
    const game = useGame.getState();

    if (game.phase !== 'playing') {
      // Anything but a run clears the road. Returning to the title screen with
      // the last run's traffic still parked on it reads as a bug.
      if (wasPlaying.current) {
        for (const car of pool) {
          car.idle = true;
          car.node.visible = false;
        }
        wasPlaying.current = false;
      }
      nextAt.current = runtime.distance + CAR_GRACE * runtime.speed;
      return;
    }

    // The road ahead is filled in the moment the run starts rather than left
    // to fill itself one car at a time. Spawning only at the fog line means
    // the first car is however long the whole visible road takes to travel —
    // the best part of ten seconds of nothing to do at the very point the
    // player is deciding whether this is a game worth playing.
    if (!wasPlaying.current) {
      wasPlaying.current = true;
      let at = CAR_GRACE * runtime.speed;
      while (at < -CAR_SPAWN_Z) {
        place(at);
        at += CAR_GAP_MIN + Math.random() * (CAR_GAP_MAX - CAR_GAP_MIN);
      }
      nextAt.current = runtime.distance + at + CAR_SPAWN_Z;
    }

    if (runtime.distance >= nextAt.current) {
      nextAt.current = runtime.distance + CAR_GAP_MIN + Math.random() * (CAR_GAP_MAX - CAR_GAP_MIN);
      place(-CAR_SPAWN_Z);
    }

    for (const car of pool) {
      if (car.idle) continue;

      // Cars are stationary scenery; it is the world that moves past them, so
      // where a car is on screen is only ever where it was put minus how far
      // the cone has come since.
      const z = car.z + runtime.distance;
      if (z > CAR_RETIRE_Z) {
        car.idle = true;
        car.node.visible = false;
        continue;
      }

      car.node.position.set(LANES[car.lane].x, 0, z);

      if (Math.abs(z) < CAR_HIT_Z && Math.abs(runtime.x - LANES[car.lane].x) < CAR_HIT_X) {
        game.endRun();
        break;
      }
    }
  });

  return (
    <group>
      {pool.map((car, index) => (
        <primitive key={index} object={car.node} />
      ))}
    </group>
  );
}

MODEL_URLS.forEach((url) => useGLTF.preload(url));
