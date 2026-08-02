import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedMesh,
  Object3D,
  ShaderMaterial,
  type Mesh,
  type MeshBasicMaterial,
} from 'three';
import { LANES, LANE_WIDTH } from './constants';
import { runtime } from './store';
import { makePuffTexture } from './textures';

/**
 * Volumetric fire, after Kosate Limpongsa's WebGL fire simulation (MIT):
 * https://github.com/neungkl/fire-simulation
 *
 * The idea there, and here, is that a flame is not a particle system. Particles
 * give you a countable number of separate things, and a flame has no separate
 * things in it — which is why a puff trail behind the cone read as smoke, or
 * worse. Instead a sphere's vertices are pushed around by 3D noise scrolling
 * upward through them, so the surface itself boils. Several of these "flame
 * balls" stacked at decreasing size make a plume, and shading them by how far
 * the noise pushed each vertex gives the white-hot core, orange body and dark
 * cool tips that a fire actually has.
 *
 * The whole thing costs three small spheres and a noise call per vertex.
 */

/**
 * Simplex noise by Ashima Arts / Stefan Gustavson (MIT). Included rather than
 * imported because it has to run on the GPU.
 */
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uFrequency;
uniform float uDisplace;
uniform float uThrottle;

varying float vHeat;

void main() {
  // Two octaves: the slow one is the body of the flame rolling over, the fast
  // one is the flicker on its surface. Both scroll down in Y, which from the
  // flame's point of view is the direction it is being blown.
  float slow = snoise(vec3(position.xz * uFrequency, position.y * uFrequency - uTime * 1.6).xzy);
  float fast = snoise(vec3(position.xz * uFrequency * 2.3, position.y * uFrequency * 2.3 - uTime * 3.4).xzy);
  float wobble = slow * 0.68 + fast * 0.32;

  // 0 at the root, 1 at the tip. The tip is free to thrash; the root is
  // pinned, because a flame that wobbles where it meets the object it is
  // coming out of visibly detaches from it.
  float along = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);

  vec3 displaced = position + normal * wobble * uDisplace * along * along;
  // Taper to a point so the plume ends rather than stopping.
  displaced.xz *= mix(1.0, 0.25, along);

  // Hot at the root, cooling along its length, and modulated by the noise so
  // the bright core is ragged rather than a smooth gradient.
  vHeat = clamp((1.0 - along) * 1.25 + wobble * 0.3, 0.0, 1.0) * uThrottle;

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
  vec3 colour = mix(uCool, uMid, smoothstep(0.0, 0.5, vHeat));
  colour = mix(colour, uHot, smoothstep(0.55, 0.95, vHeat));

  // Additive, so the alpha is really just how much light this adds. Squaring
  // it keeps the cool outer edges from building into a solid haze where the
  // layers of the plume overlap.
  float strength = smoothstep(0.04, 0.5, vHeat);
  gl_FragColor = vec4(colour * strength, strength * strength * uOpacity);
}
`;

/** Root to tip: position along the plume, radius, length, noise frequency. */
const BALLS = [
  { at: 0.3, radius: 0.62, length: 1.0, frequency: 2.2, displace: 0.3 },
  { at: 1.15, radius: 0.44, length: 0.8, frequency: 3.2, displace: 0.34 },
  { at: 1.85, radius: 0.28, length: 0.6, frequency: 4.6, displace: 0.32 },
];

const SPARK_COUNT = 26;
const SPARK_RATE = 22;
const SPARK_LIFE = 0.55;

interface Spark {
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

/**
 * The flame, and the sparks it throws off.
 *
 * Lives inside the cone's tilt group, so "backward" is simply local -Y
 * whichever way the cone happens to be pointing, and the plume stays glued to
 * the base through the whole launch without any of this needing to know what
 * the launch animation is doing.
 */
export function Fire({ intensity }: { intensity: React.RefObject<number> }) {
  const sparkMesh = useRef<InstancedMesh>(null);
  const nozzle = useRef<Mesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const sparkTexture = useMemo(makePuffTexture, []);
  const tint = useMemo(() => new Color(), []);
  const ember = useMemo(() => new Color('#ff5a12'), []);
  const laneColours = useMemo(() => LANES.map((lane) => new Color(lane.color)), []);

  const materials = useMemo(
    () =>
      BALLS.map(
        (ball, index) =>
          new ShaderMaterial({
            vertexShader: `${NOISE}\n${VERTEX}`,
            fragmentShader: FRAGMENT,
            uniforms: {
              // Staggered, so the three balls are never boiling in step.
              uTime: { value: index * 7.3 },
              uFrequency: { value: ball.frequency },
              uDisplace: { value: ball.displace },
              uThrottle: { value: 0 },
              uOpacity: { value: 0 },
              uHot: { value: new Color('#fff3cf') },
              uMid: { value: new Color('#ff9522') },
              uCool: { value: new Color('#e5300c') },
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

  const sparks = useMemo<Spark[]>(
    () =>
      Array.from({ length: SPARK_COUNT }, () => ({
        age: Infinity,
        life: SPARK_LIFE,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        size: 0,
      })),
    [],
  );

  const backlog = useRef(0);

  useFrame(({ camera }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const throttle = intensity.current;

    // The lane's colour, blended across the gap, washed into the flame's cool
    // tip only. A fully lane-coloured flame stops looking like fire.
    const position = Math.max(0, Math.min(2, runtime.x / LANE_WIDTH + 1));
    const low = Math.floor(position);
    tint.copy(laneColours[low]).lerp(laneColours[Math.min(2, low + 1)], position - low);
    tint.lerp(ember, 0.62);

    for (const material of materials) {
      material.uniforms.uTime.value += delta;
      material.uniforms.uThrottle.value = throttle;
      material.uniforms.uOpacity.value = throttle;
      (material.uniforms.uCool.value as Color).copy(tint);
    }

    if (nozzle.current) {
      const flicker = 0.86 + Math.sin(materials[0].uniforms.uTime.value * 34) * 0.14;
      (nozzle.current.material as MeshBasicMaterial).opacity = throttle * flicker;
      nozzle.current.scale.setScalar(0.9 + throttle * 0.35);
    }

    const mesh = sparkMesh.current;
    if (!mesh) return;

    backlog.current += throttle * SPARK_RATE * delta;
    let spawns = Math.floor(backlog.current);
    backlog.current -= spawns;

    for (let index = 0; index < SPARK_COUNT; index++) {
      const spark = sparks[index];
      spark.age += delta;

      if (spark.age >= spark.life && spawns > 0) {
        spawns--;
        spark.age = 0;
        spark.life = SPARK_LIFE * (0.6 + Math.random() * 0.8);
        const around = Math.random() * Math.PI * 2;
        const ring = Math.random() * 0.18;
        spark.x = Math.cos(around) * ring;
        spark.y = -0.3 - Math.random() * 0.5;
        spark.z = Math.sin(around) * ring;
        spark.vx = Math.cos(around) * (0.5 + Math.random() * 0.9);
        spark.vy = -(1.6 + Math.random() * 1.8);
        spark.vz = Math.sin(around) * (0.5 + Math.random() * 0.9);
        spark.size = 0.035 + Math.random() * 0.045;
      }

      if (spark.age >= spark.life) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        continue;
      }

      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
      spark.z += spark.vz * delta;
      const drag = 1 - 1.8 * delta;
      spark.vx *= drag;
      spark.vy *= drag;
      spark.vz *= drag;

      const life = spark.age / spark.life;
      dummy.position.set(spark.x, spark.y, spark.z);
      dummy.quaternion.copy(camera.quaternion);
      dummy.scale.setScalar(spark.size * (1 - life * 0.75));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    // Built growing along +Y, then turned over: inside the cone's tilt group
    // the direction it should stream is -Y.
    <group rotation={[Math.PI, 0, 0]}>
      {/* A hot disc right in the mouth of the cone's base. It reads as the
          throat of the jet, and it covers the hollow underside of the moulding
          that the chase camera would otherwise be looking straight into. */}
      <mesh ref={nozzle} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.15, 1.15]} />
        <meshBasicMaterial
          map={sparkTexture}
          color="#ffd88a"
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {BALLS.map((ball, index) => (
        <mesh
          key={index}
          position={[0, ball.at, 0]}
          scale={[ball.radius, ball.length, ball.radius]}
          material={materials[index]}
          frustumCulled={false}
        >
          <sphereGeometry args={[1, 28, 22]} />
        </mesh>
      ))}

      <instancedMesh
        ref={sparkMesh}
        args={[undefined, undefined, SPARK_COUNT]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={sparkTexture}
          color="#ffcf7a"
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}
