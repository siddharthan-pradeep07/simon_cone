import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  ShaderMaterial,
} from 'three';
import { NOISE } from './Fire';
import { runtime, useGame } from './store';
import { makePuffTexture } from './textures';

/**
 * The fireball, built out of the same noise-displaced spheres as the thruster
 * flame. An explosion is a flame that is briefly much larger and then stops,
 * so most of the work was already done; what differs is that these expand,
 * cool and thin out over about a second rather than burning steadily.
 */
const VERTEX = /* glsl */ `
uniform float uProgress;
uniform float uFrequency;
uniform float uSeed;

varying float vHeat;

void main() {
  float slow = snoise(position * uFrequency + uSeed);
  float fast = snoise(position * uFrequency * 2.4 + uSeed + 31.0);
  float wobble = slow * 0.66 + fast * 0.34;

  // The ball is lumpy from the first frame and gets lumpier as it grows, which
  // is what keeps it from ever reading as the sphere it actually is.
  vec3 displaced = position * (1.0 + wobble * (0.3 + uProgress * 0.55));

  // Hot in the middle of the blast, cooling from the outside in. The noise is
  // mixed into the heat as well so the fire breaks up into pockets instead of
  // dimming as one even mass.
  vHeat = clamp(1.35 - uProgress * 1.5 + wobble * 0.4, 0.0, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uMid;
uniform vec3 uCool;
uniform float uOpacity;

varying float vHeat;

void main() {
  vec3 colour = mix(uCool, uMid, smoothstep(0.0, 0.45, vHeat));
  colour = mix(colour, uHot, smoothstep(0.5, 0.9, vHeat));

  float strength = smoothstep(0.02, 0.4, vHeat);
  gl_FragColor = vec4(colour * strength, strength * strength * uOpacity);
}
`;

/** Offset, final radius, noise frequency and how late each ball joins in. */
const BALLS = [
  { at: [0, 0.1, 0], radius: 3.1, frequency: 1.5, seed: 0, delay: 0 },
  { at: [-1.1, 0.9, 0.4], radius: 2.1, frequency: 2.1, seed: 17, delay: 0.09 },
  { at: [1.2, 0.6, -0.5], radius: 2.0, frequency: 2.3, seed: 44, delay: 0.15 },
  { at: [0.2, 1.9, 0.3], radius: 1.6, frequency: 2.8, seed: 71, delay: 0.24 },
];

const DEBRIS_COUNT = 34;

/** Seconds from the bang to the last ember going out. */
const DURATION = 1.5;

interface Shard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  spin: number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 2.4;

/**
 * The crash.
 *
 * Watches for the run ending and fires once, wherever the cone was standing at
 * the time. It owns nothing else: the cone hides itself, the sound plays from
 * the store, and this draws the fireball, the shockwave along the road and the
 * debris thrown out of it.
 */
export function Explosion() {
  const group = useRef<Group>(null);
  const shockwave = useRef<Mesh>(null);
  const debrisMesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const puff = useMemo(makePuffTexture, []);

  /** Seconds since the bang. Past DURATION, nothing is drawn at all. */
  const age = useRef(Infinity);
  const wasPlaying = useRef(false);

  const materials = useMemo(
    () =>
      BALLS.map(
        (ball) =>
          new ShaderMaterial({
            vertexShader: `${NOISE}\n${VERTEX}`,
            fragmentShader: FRAGMENT,
            uniforms: {
              uProgress: { value: 0 },
              uFrequency: { value: ball.frequency },
              uSeed: { value: ball.seed },
              uOpacity: { value: 0 },
              uHot: { value: new Color('#fff6dd') },
              uMid: { value: new Color('#ff9a1f') },
              uCool: { value: new Color('#c41f06') },
            },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
            toneMapped: false,
          }),
      ),
    [],
  );

  const debris = useMemo<Shard[]>(
    () =>
      Array.from({ length: DEBRIS_COUNT }, () => ({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 0,
        spin: 0,
      })),
    [],
  );

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const holder = group.current;
    if (!holder) return;

    const phase = useGame.getState().phase;

    // The one transition that matters: a run that was underway is no longer
    // underway, which in this game only ever means the cone hit something.
    if (phase === 'playing') {
      wasPlaying.current = true;
    } else if (wasPlaying.current) {
      wasPlaying.current = false;
      age.current = 0;
      holder.position.set(runtime.x, runtime.height, 0);

      for (const shard of debris) {
        // Thrown out along a random direction, biased upward — straight out of
        // a sphere sends half the debris into the road.
        const around = Math.random() * Math.PI * 2;
        const up = 0.25 + Math.random() * 0.75;
        const flat = Math.sqrt(1 - up * up);
        const speed = 6 + Math.random() * 11;
        shard.x = 0;
        shard.y = 0;
        shard.z = 0;
        shard.vx = Math.cos(around) * flat * speed;
        shard.vy = up * speed;
        shard.vz = Math.sin(around) * flat * speed;
        shard.size = 0.1 + Math.random() * 0.22;
        shard.spin = (Math.random() - 0.5) * 9;
      }
    }

    if (age.current >= DURATION) {
      if (holder.visible) holder.visible = false;
      return;
    }
    holder.visible = true;
    age.current += delta;

    const life = Math.min(1, age.current / DURATION);

    for (let index = 0; index < BALLS.length; index++) {
      const ball = BALLS[index];
      const material = materials[index];
      // Each ball has its own clock, started a little after the last, so the
      // fireball unfolds outward instead of appearing all at once.
      const own = Math.max(0, (life - ball.delay) / (1 - ball.delay));
      material.uniforms.uProgress.value = own;
      material.uniforms.uOpacity.value = own <= 0 ? 0 : Math.max(0, 1 - own * own);
      const mesh = holder.children[index] as Mesh;
      // Fast out of the gate and decelerating, the way a blast front actually
      // behaves against the air.
      mesh.scale.setScalar(0.25 + easeOut(own) * ball.radius);
    }

    if (shockwave.current) {
      const ring = Math.min(1, life * 2.2);
      shockwave.current.scale.setScalar(0.5 + easeOut(ring) * 13);
      (shockwave.current.material as MeshBasicMaterial).opacity = 0.5 * (1 - ring) ** 1.6;
      // Pinned to the road rather than to the blast, which happens in mid-air.
      shockwave.current.position.y = -runtime.height + 0.06;
    }

    const mesh = debrisMesh.current;
    if (mesh) {
      const fade = Math.max(0, 1 - life * 1.3);
      (mesh.material as MeshBasicMaterial).opacity = fade;
      for (let index = 0; index < DEBRIS_COUNT; index++) {
        const shard = debris[index];
        shard.vy -= 24 * delta;
        shard.x += shard.vx * delta;
        shard.y += shard.vy * delta;
        shard.z += shard.vz * delta;
        dummy.position.set(shard.x, shard.y, shard.z);
        dummy.rotation.set(shard.spin * age.current, shard.spin * age.current * 0.7, 0);
        dummy.scale.setScalar(shard.size * fade);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={group} visible={false}>
      {BALLS.map((ball, index) => (
        <mesh
          key={index}
          position={[ball.at[0], ball.at[1], ball.at[2]]}
          material={materials[index]}
          frustumCulled={false}
        >
          <sphereGeometry args={[1, 26, 20]} />
        </mesh>
      ))}

      <mesh ref={shockwave} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
        <ringGeometry args={[0.72, 1, 40]} />
        <meshBasicMaterial
          color="#ffd9a0"
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>

      <instancedMesh
        ref={debrisMesh}
        args={[undefined, undefined, DEBRIS_COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          map={puff}
          color="#ffb257"
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}
