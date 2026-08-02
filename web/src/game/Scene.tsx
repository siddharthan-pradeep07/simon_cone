import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { ACESFilmicToneMapping, FogExp2 } from 'three';
import { FOG_COLOUR } from './constants';
import { Cone, ConeShadow } from './Cone';
import { Explosion } from './Explosion';
import { CameraRig, GameLoop } from './GameLoop';
import { Sky } from './Sky';
import { Track } from './Track';
import { Traffic } from './Traffic';

/** Where the road fades out. Matches the haze at the sky's horizon. */
const FOG = new FogExp2(FOG_COLOUR, 0.011);

export function Scene() {
  return (
    <Canvas
      className="stage"
      // Capped low deliberately. This is a full-screen scene with a panorama
      // behind it; on a high-DPI display the honest device ratio quadruples
      // the pixels shaded for a look that is already flat colour.
      dpr={[1, 1.35]}
      gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 50, near: 0.1, far: 900, position: [0, 1.7, 6.2] }}
      onCreated={({ gl, scene }) => {
        // Tone mapping is on for the sake of the sky alone, which is a real
        // high-dynamic-range photograph and clips to flat white without it.
        // Every game material sets `toneMapped={false}` and so passes through
        // untouched, which is what keeps the lanes exactly the colour they are
        // specified as.
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.1;
        scene.fog = FOG;
      }}
    >
      {/* First, so everything below reads a world that has already advanced. */}
      <GameLoop />
      <CameraRig />

      <Suspense fallback={null}>
        <Sky />
      </Suspense>

      <Track />
      <Suspense fallback={null}>
        <Traffic />
      </Suspense>
      <ConeShadow />
      <Cone />
      <Explosion />
    </Canvas>
  );
}
