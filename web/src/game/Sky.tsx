import { useLoader, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { EquirectangularReflectionMapping } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const SKY_URL = '/sky/sky.hdr';

/**
 * A photographed sky, used as the scene background.
 *
 * This replaces a dome of billboard clouds. Billboards give away that they are
 * flat cards the moment the camera moves, and there is no arrangement of them
 * that looks like weather. A single equirectangular panorama has real cloud
 * structure and real depth in its horizon, costs one draw of the background,
 * and never has to be animated because a sky at this distance does not visibly
 * move anyway.
 *
 * It is high dynamic range, so unlike everything else in the scene it does get
 * tone mapped — that is what keeps the bright cloud edges from clipping to
 * flat white. Every game material opts out of tone mapping instead, so their
 * colours stay exactly as authored.
 */
export function Sky() {
  const texture = useLoader(RGBELoader, SKY_URL);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    texture.mapping = EquirectangularReflectionMapping;
    scene.background = texture;
    scene.backgroundIntensity = 1.15;
    return () => {
      scene.background = null;
    };
  }, [texture, scene]);

  return null;
}
