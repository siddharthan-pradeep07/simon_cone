import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { InstancedMesh, Object3D, PlaneGeometry } from 'three';
import { LANES, LANE_WIDTH, ROAD_LENGTH, ROAD_WIDTH } from './constants';
import { runtime } from './store';
import { makeGroundTexture, makeLaneGradient } from './textures';

/** The road is drawn from here forward; the far end is always inside the fog. */
const ROAD_CENTRE_Z = -ROAD_LENGTH / 2 + 30;

/** World units covered by one repeat of the ground texture down its length. */
const GROUND_TILE = ROAD_LENGTH / 26;

const DASH_SPACING = 11;
const DASH_COUNT = 18;
/** Where the nearest dash starts, just behind the camera. */
const DASH_START_Z = 20;

/**
 * Three flat colour strips. The only variation across them is a couple of
 * percent of shading at the edges, which stops the road reading as a single
 * painted rectangle without changing the colour the player is matching to.
 */
function Lanes() {
  const gradient = useMemo(makeLaneGradient, []);

  return (
    <group>
      {LANES.map((lane) => (
        <mesh
          key={lane.index}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[lane.x, 0.01, ROAD_CENTRE_Z]}
        >
          <planeGeometry args={[LANE_WIDTH, ROAD_LENGTH]} />
          <meshBasicMaterial map={gradient} color={lane.surface} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Dashes running down each lane, recycled as the world scrolls.
 *
 * The road surface itself has no pattern, so these carry most of the sense of
 * speed. They are laid out in world space rather than inside the road's group:
 * that group is pushed a hundred units downrange so its far end sits in the
 * fog, and instance positions measured from there put every dash out past the
 * horizon instead of under the cone.
 */
function Dashes() {
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const total = DASH_COUNT * LANES.length;

  useFrame(() => {
    const target = mesh.current;
    if (!target) return;
    const slide = runtime.distance % DASH_SPACING;
    for (let index = 0; index < total; index++) {
      const lane = index % LANES.length;
      const step = (index - lane) / LANES.length;
      dummy.position.set(LANES[lane].x, 0, DASH_START_Z - step * DASH_SPACING + slide);
      dummy.updateMatrix();
      target.setMatrixAt(index, dummy.matrix);
    }
    target.instanceMatrix.needsUpdate = true;
  });

  // The flat-on-the-road rotation is baked into the geometry rather than set
  // on the mesh: a rotation on the mesh would also rotate the instance
  // matrices, and lay the dashes out up the Y axis instead of along the road.
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(0.55, 3.6);
    plane.rotateX(-Math.PI / 2);
    return plane;
  }, []);

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, total]}
      position={[0, 0.03, 0]}
      frustumCulled={false}
    >
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.62}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function Ground() {
  const paving = useMemo(() => makeGroundTexture(), []);

  useFrame(() => {
    paving.offset.y = (runtime.distance / GROUND_TILE) % 1;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, ROAD_CENTRE_Z]}>
      <planeGeometry args={[ROAD_LENGTH * 2, ROAD_LENGTH]} />
      <meshBasicMaterial map={paving} toneMapped={false} />
    </mesh>
  );
}

/** A white kerb line down each outer edge, to give the road a defined shape. */
function Edges() {
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[side * (ROAD_WIDTH / 2 + 0.14), 0.02, ROAD_CENTRE_Z]}
        >
          <planeGeometry args={[0.28, ROAD_LENGTH]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export function Track() {
  return (
    <group>
      <Ground />
      <Lanes />
      <Edges />
      <Dashes />
    </group>
  );
}
