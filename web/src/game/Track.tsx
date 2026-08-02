import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { LANES, LANE_WIDTH, ROAD_LENGTH, ROAD_WIDTH } from './constants';
import { runtime } from './store';
import { makeGroundTexture, makeLaneGradient } from './textures';

/** The road is drawn from here forward; the far end is always inside the fog. */
const ROAD_CENTRE_Z = -ROAD_LENGTH / 2 + 30;

/** World units covered by one repeat of the ground texture down its length. */
const GROUND_TILE = ROAD_LENGTH / 26;

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
    </group>
  );
}
