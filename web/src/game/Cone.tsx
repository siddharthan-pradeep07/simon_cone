import { useFBX, useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import {
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  Object3D,
  Raycaster,
  Vector3,
  type Texture,
} from 'three';
import {
  CONE_FLY_HEIGHT,
  CONE_MENU_POSITION,
  CONE_MENU_YAW,
  LANE_BANK,
  LANE_BANK_MAX,
} from './constants';
import { Fire } from './Fire';
import { runtime, useGame } from './store';
import { makeMatcapTexture, makePuffTexture, recolourCone } from './textures';

/** Height the model is normalised to, base to tip, whatever it was exported at. */
const CONE_HEIGHT = 2.2;
const HALF = CONE_HEIGHT / 2;

/**
 * Nose-forward attitude — but only about sixty degrees over, not the full
 * ninety.
 *
 * Laid out flat the cone points its base plate squarely down the camera's
 * throat, and a traffic cone's base is a wide flat square with a hollow in it.
 * The character disappears behind its own least interesting surface and the
 * face ends up edge-on. Held back at this angle the nose still leads, the
 * flank the face is painted on turns up towards the chase camera, and the
 * exhaust streams back and down at the road instead of straight at the player.
 */
const FLIGHT_PITCH = -1.0;

const MODEL_URL = '/models/cone.fbx';
const MODEL_TEXTURE_URL = '/models/cone_basecolor.png';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const range = (value: number, from: number, to: number) => clamp01((value - from) / (to - from));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => {
  const c1 = 1.9;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
/** Frame-rate independent approach, so the feel does not change with refresh rate. */
const approach = (current: number, target: number, rate: number, delta: number) =>
  current + (target - current) * (1 - Math.exp(-rate * delta));

/**
 * Where the cone's surface actually is, found by firing a ray at it.
 *
 * The face has to sit on the model, and the model is whatever was downloaded.
 * Assuming a profile puts the eyes either buried inside the mesh or floating
 * off it, and which one depends on the model. Measuring costs a handful of ray
 * casts once, works for any cone-shaped thing, and means the face still lands
 * correctly if this model is swapped for another.
 */
function measureProfile(model: Object3D) {
  model.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  const start = new Vector3();
  const inward = new Vector3(0, 0, -1);
  const REACH = 10;

  const radiusAt = (y: number) => {
    start.set(0, y, REACH);
    raycaster.set(start, inward);
    const hit = raycaster.intersectObject(model, true)[0];
    return hit ? REACH - hit.distance : 0.3;
  };

  return radiusAt;
}

/** How far the flank leans back, so features lie against it, not through it. */
function slopeAt(radiusAt: (y: number) => number, y: number) {
  const span = 0.12;
  const below = radiusAt(y - span);
  const above = radiusAt(y + span);
  // Negative: the surface normal points outward and upward.
  return -Math.atan((below - above) / (span * 2));
}

interface Profile {
  radiusAt: (y: number) => number;
  eyeY: number;
  smileY: number;
}

/**
 * The face sits *on* the cone, never inside it.
 *
 * This is what was making the eyes flicker and tear during a run. They were
 * being sunk below the surface so the cone would trim their edges, which works
 * on a still image but means the mesh is cutting through them: the moment the
 * cone banks, pitches or moves relative to the camera, the intersection
 * contour moves too, and the eye is re-clipped every frame. Depth precision at
 * a grazing angle finishes the job.
 *
 * Held just clear of the surface there is nothing to intersect and nothing to
 * flicker. The features are flattened hard along the surface normal so they
 * still read as painted on rather than glued on, and biased towards the camera
 * so no amount of depth-buffer imprecision can let the cone win.
 */
const FACE_MATERIAL = {
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
} as const;

/** How flat the features are pressed against the flank. */
const FACE_DEPTH = 0.34;

function Eye({ side, profile }: { side: number; profile: Profile }) {
  const y = profile.eyeY;
  const radius = profile.radiusAt(y);
  const slope = slopeAt(profile.radiusAt, y);

  // Sized and spread from the cone's actual girth at this height. Fixed
  // numbers would either overlap into one eye or slide round to the sides,
  // depending only on how fat the model happens to be here.
  const eye = Math.min(0.15, radius * 0.4);
  const angle = side * Math.asin(Math.min(0.72, (eye * 1.5) / radius));

  // Far enough out that the back pole of the ellipsoid grazes the surface,
  // leaving no gap and no intersection anywhere the player can see.
  const stand = radius + eye * FACE_DEPTH * 0.92;

  return (
    <group
      position={[Math.sin(angle) * stand, y, Math.cos(angle) * stand]}
      rotation={[slope, angle, 0]}
      renderOrder={2}
    >
      <mesh scale={[1, 1.15, FACE_DEPTH]}>
        <sphereGeometry args={[eye, 20, 16]} />
        <meshBasicMaterial color="#ffffff" {...FACE_MATERIAL} />
      </mesh>
      <mesh position={[0, 0, eye * 0.3]} scale={[1, 1.05, FACE_DEPTH]}>
        <sphereGeometry args={[eye * 0.53, 16, 12]} />
        <meshBasicMaterial color="#2a1c33" {...FACE_MATERIAL} />
      </mesh>
      <mesh position={[eye * 0.22, eye * 0.26, eye * 0.44]} scale={[1, 1, FACE_DEPTH]}>
        <sphereGeometry args={[eye * 0.19, 10, 8]} />
        <meshBasicMaterial color="#ffffff" {...FACE_MATERIAL} />
      </mesh>
    </group>
  );
}

function Smile({ profile }: { profile: Profile }) {
  const y = profile.smileY;
  const radius = profile.radiusAt(y);
  const slope = slopeAt(profile.radiusAt, y);
  const width = Math.min(0.19, radius * 0.52);
  const thickness = width * 0.19;

  return (
    <group
      position={[0, y, radius + thickness]}
      rotation={[slope, 0, Math.PI]}
      scale={[1, 1, FACE_DEPTH * 2]}
      renderOrder={2}
    >
      <mesh>
        <torusGeometry args={[width, thickness, 8, 24, Math.PI]} />
        <meshBasicMaterial color="#3a1f14" side={DoubleSide} {...FACE_MATERIAL} />
      </mesh>
    </group>
  );
}

/**
 * Eyes and a smile, applied to whatever cone is underneath — and taken off
 * again the moment it tips over into flight.
 *
 * Nose-forward, the flank the face is painted on is raked away from the camera
 * and most of what is left on screen is the back of the cone. The face reads
 * as a squashed smear on a surface it no longer fits, so it comes off halfway
 * through the launch, while the cone is spinning and nobody can see it go.
 */
function Face({ profile }: { profile: Profile }) {
  const group = useRef<Group>(null);

  useFrame(() => {
    const target = group.current;
    if (!target) return;
    const phase = useGame.getState().phase;
    target.visible =
      phase === 'menu' || phase === 'over' || (phase === 'intro' && runtime.intro < 0.45);
  });

  return (
    <group ref={group}>
      <Eye side={-1} profile={profile} />
      <Eye side={1} profile={profile} />
      <Smile profile={profile} />
    </group>
  );
}

/**
 * The downloaded cone, normalised so it occupies exactly the space the game
 * expects: two units tall, centred on the origin, base at -1. Without this the
 * scene would have to be retuned around whatever scale the model happened to
 * be exported at — and FBX from asset sites is routinely in centimetres.
 *
 * Its materials are replaced rather than adjusted. The model ships PBR maps
 * for a lit renderer and there are no lights here; a matcap gives it back its
 * roundness with no lights and one texture lookup.
 */
function LoadedCone() {
  const source = useFBX(MODEL_URL);
  const painted = useTexture(MODEL_TEXTURE_URL) as Texture;
  const matcap = useMemo(makeMatcapTexture, []);

  const { model, profile, baseRadius } = useMemo(() => {
    const clone = source.clone(true);

    const size = new Vector3();
    new Box3().setFromObject(clone).getSize(size);
    clone.scale.setScalar(CONE_HEIGHT / (size.y || 1));

    const box = new Box3().setFromObject(clone);
    const centre = new Vector3();
    box.getCenter(centre);
    clone.position.set(-centre.x, -box.min.y - HALF, -centre.z);

    const material = new MeshMatcapMaterial({
      map: recolourCone(painted.image as CanvasImageSource),
      matcap,
    });
    material.toneMapped = false;
    clone.traverse((child) => {
      if (child instanceof Mesh) child.material = material;
    });

    const radiusAt = measureProfile(clone);
    return {
      model: clone,
      // Real traffic cones are moulded, so the underside of the base is a
      // hollow. Fine on the ground, where nothing can see it; once the cone is
      // flying nose-forward the chase camera is looking right into it.
      baseRadius: radiusAt(-HALF + 0.06),
      // Up on the shoulder for the eyes, below them for the mouth — as a
      // fraction of the height, so it survives a change of model.
      profile: { radiusAt, eyeY: HALF * 0.16, smileY: -HALF * 0.14 } satisfies Profile,
    };
  }, [source, painted, matcap]);

  return (
    <group>
      <primitive object={model} />
      <mesh position={[0, -HALF + 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[baseRadius, 28]} />
        <meshBasicMaterial color="#d4570d" side={DoubleSide} toneMapped={false} />
      </mesh>
      <Face profile={profile} />
    </group>
  );
}

/** Shown while the model is still downloading. */
function PlaceholderCone() {
  const matcap = useMemo(makeMatcapTexture, []);
  return (
    <mesh>
      <coneGeometry args={[0.62, CONE_HEIGHT, 32, 1]} />
      <meshMatcapMaterial color="#ff6a15" matcap={matcap} />
    </mesh>
  );
}

/**
 * A blob on the road under the cone. There are no lights and so no real
 * shadows, but the one job a shadow does here is telling the player how high
 * the cone is and which lane it is over, and a blob does that job.
 */
export function ConeShadow() {
  const mesh = useRef<Mesh>(null);
  const puff = useMemo(makePuffTexture, []);

  useFrame(() => {
    const target = mesh.current;
    if (!target) return;
    target.position.x = runtime.x;
    const spread = 1 + Math.max(0, runtime.height - 1) * 0.5;
    target.scale.set(1.7 * spread, 2.2 * spread, 1);
    (target.material as MeshBasicMaterial).opacity = 0.2 / (spread * spread);
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={puff}
        color="#241733"
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Position and attitude for every phase of the game.
 *
 * Two nested groups, because the rotations do not compose in one. The outer
 * one yaws and banks in world space — that is steering. The inner one spins
 * about the cone's own axis and tips it nose-forward — that is the character.
 * Flattened into a single Euler these fight each other the moment the cone is
 * both tipped over and turning.
 */
export function Cone() {
  const rig = useRef<Group>(null);
  const tilt = useRef<Group>(null);
  const throttle = useRef(0);
  const clock = useRef(0);
  const spin = useRef({ from: 0, to: 0 });
  const wasIntro = useRef(false);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const group = rig.current;
    const inner = tilt.current;
    if (!group || !inner) return;

    clock.current += delta;
    const phase = useGame.getState().phase;

    if (phase === 'menu' || phase === 'over') {
      wasIntro.current = false;
      const bob = Math.sin(clock.current * 1.7) * 0.07;
      group.position.x = approach(group.position.x, CONE_MENU_POSITION[0], 5, delta);
      group.position.y = approach(group.position.y, CONE_MENU_POSITION[1] + bob, 5, delta);
      group.rotation.y = approach(group.rotation.y, 0, 6, delta);
      group.rotation.z = approach(group.rotation.z, 0, 6, delta);
      inner.rotation.x = approach(inner.rotation.x, 0, 6, delta);
      // Faces the camera and stays there. A cone turning on the spot puts its
      // back to the player for half of every rotation, which is half the time
      // the title screen has no face on it.
      inner.rotation.y = approach(inner.rotation.y, CONE_MENU_YAW, 6, delta);
      throttle.current = approach(throttle.current, 0, 5, delta);
      // The launch animation owns the cone's position, so it publishes it back
      // for the trail colour and the shadow to follow.
      runtime.x = group.position.x;
      runtime.vx = 0;
      runtime.height = group.position.y;
      return;
    }

    if (phase === 'intro' && !wasIntro.current) {
      wasIntro.current = true;
      // Two whole turns during the launch. It ends on a multiple of a full
      // turn rather than on wherever it started, so the yaw it was posed with
      // for the title screen is unwound and it flies dead ahead.
      spin.current = { from: inner.rotation.y, to: 4 * Math.PI };
    }

    if (phase === 'playing') {
      const hover = Math.sin(clock.current * 2.6) * 0.075;
      group.position.x = runtime.x;
      group.position.y = CONE_FLY_HEIGHT + hover;
      group.rotation.z = Math.max(
        -LANE_BANK_MAX,
        Math.min(LANE_BANK_MAX, -runtime.vx * LANE_BANK),
      );
      group.rotation.y = Math.max(-0.45, Math.min(0.45, -runtime.vx * 0.022));
      inner.rotation.x = FLIGHT_PITCH;
      inner.rotation.y = spin.current.to;
      throttle.current = approach(throttle.current, 1, 6, delta);
    } else {
      const progress = runtime.intro;
      // Up in a hop, then down into the cruise height.
      const peak = CONE_MENU_POSITION[1] + 1.25;
      const rise = easeOutBack(range(progress, 0, 0.45));
      const settle = smoothstep(range(progress, 0.42, 0.88));

      group.position.x = CONE_MENU_POSITION[0] * (1 - smoothstep(range(progress, 0.18, 0.8)));
      group.position.y =
        CONE_MENU_POSITION[1] +
        (peak - CONE_MENU_POSITION[1]) * rise +
        (CONE_FLY_HEIGHT - peak) * settle;
      group.rotation.y = 0;
      group.rotation.z = 0;
      inner.rotation.y =
        spin.current.from +
        (spin.current.to - spin.current.from) * easeOutCubic(range(progress, 0, 0.72));
      inner.rotation.x = FLIGHT_PITCH * easeOutBack(range(progress, 0.5, 0.95));
      throttle.current = range(progress, 0.5, 0.95);
      runtime.x = group.position.x;
      runtime.vx = 0;
    }

    runtime.height = group.position.y;
  });

  return (
    <group ref={rig} position={[CONE_MENU_POSITION[0], CONE_MENU_POSITION[1], 0]}>
      <group ref={tilt}>
        <Suspense fallback={<PlaceholderCone />}>
          <LoadedCone />
        </Suspense>
        <group position={[0, -HALF + 0.05, 0]}>
          <Fire intensity={throttle} />
        </group>
      </group>
    </group>
  );
}
