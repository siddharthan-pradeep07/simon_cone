/**
 * Every texture the game draws for itself, made at load time into a canvas.
 *
 * There are no lights in this scene. Nothing is shaded and every game material
 * is unlit, so a texture here is not a surface description — it is simply the
 * colour that shows up on screen. That is what lets the lanes be exactly the
 * colour they are specified as, rather than that colour after a light has had
 * its way with it.
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d')! };
}

/**
 * The lane surface. A band across the width that is a couple of percent darker
 * at the edges than down the middle — just enough to stop three flat rectangles
 * reading as three flat rectangles, without changing the colour the player is
 * matching their card against.
 *
 * Multiplied by the lane's colour in the material, so one greyscale strip
 * serves all three lanes and the whole road is a single texture upload.
 */
export function makeLaneGradient(): Texture {
  const width = 64;
  const { canvas, ctx } = createCanvas(width, 4);

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#e6e6e6');
  gradient.addColorStop(0.14, '#f4f4f4');
  gradient.addColorStop(0.5, '#ffffff');
  gradient.addColorStop(0.86, '#f4f4f4');
  gradient.addColorStop(1, '#e6e6e6');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, 4);

  const texture = new CanvasTexture(canvas);
  // Clamped, not repeated: the gradient spans the lane exactly once and a
  // wrapped edge would put a seam down the middle of the road.
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * The paving either side of the road. Light and low contrast: it fills a lot
 * of screen and anything busier competes with the three lanes, which are the
 * only thing the player actually has to read.
 */
export function makeGroundTexture(seed = 33): Texture {
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };

  const size = 256;
  const rows = 8;
  const columns = 4;
  const brickHeight = size / rows;
  const brickWidth = size / columns;
  const mortar = 5;

  const { canvas, ctx } = createCanvas(size, size);

  ctx.fillStyle = '#a49cb0';
  ctx.fillRect(0, 0, size, size);

  for (let row = 0; row < rows; row++) {
    // Half a brick of offset on alternate rows, which is what stops it
    // reading as a grid.
    const shift = row % 2 === 0 ? 0 : brickWidth / 2;
    for (let column = -1; column < columns + 1; column++) {
      const x = column * brickWidth + shift + mortar / 2;
      const y = row * brickHeight + mortar / 2;
      const shade = random();
      ctx.fillStyle = `rgb(${(206 + shade * 24) | 0}, ${(200 + shade * 24) | 0}, ${
        (210 + shade * 22) | 0
      })`;
      ctx.beginPath();
      ctx.roundRect(x, y, brickWidth - mortar, brickHeight - mortar, 4);
      ctx.fill();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // The apron is far wider than it is long; these two very different numbers
  // are what make the bricks come out square on the ground rather than
  // stretched into planks.
  texture.repeat.set(64, 26);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** A small, soft, round blob — the sparks and the contact shadow. */
export function makePuffTexture(): Texture {
  const size = 128;
  const half = size / 2;
  const { canvas, ctx } = createCanvas(size, size);

  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.92)');
  gradient.addColorStop(0.82, 'rgba(255, 255, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * A matcap: the whole lighting model, baked into one small image.
 *
 * With no lights in the scene the cone would otherwise render as a flat
 * silhouette. A matcap shades a surface by its normal relative to the camera,
 * so this gives back the sense of a round object — bright on top, falling off
 * softly at the edges — for one texture lookup and no lights at all.
 */
export function makeMatcapTexture(): Texture {
  const size = 128;
  const half = size / 2;
  const { canvas, ctx } = createCanvas(size, size);

  ctx.clearRect(0, 0, size, size);

  // Kept high everywhere: this multiplies the cone's own colour, and anything
  // darker at the edges reads as the grime the model already has too much of.
  const base = ctx.createRadialGradient(half, half * 0.75, half * 0.1, half, half, half);
  base.addColorStop(0, '#ffffff');
  base.addColorStop(0.6, '#f2f2f2');
  base.addColorStop(0.88, '#d8d8de');
  base.addColorStop(1, '#c6c6cf');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.fill();

  const highlight = ctx.createRadialGradient(
    half * 0.66,
    half * 0.52,
    0,
    half * 0.66,
    half * 0.52,
    half * 0.85,
  );
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(half, half, half, 0, Math.PI * 2);
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Lightness and saturation of a colour, without the cost of a full HSL convert. */
function levels(red: number, green: number, blue: number) {
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 510;
  const span = high - low;
  const saturation = span === 0 ? 0 : span / (255 - Math.abs(high + low - 255));
  return { lightness, saturation };
}

/** One channel of an HSL colour, back in 0–255. */
function channel(p: number, q: number, t: number) {
  let shifted = t;
  if (shifted < 0) shifted += 1;
  if (shifted > 1) shifted -= 1;
  if (shifted < 1 / 6) return (p + (q - p) * 6 * shifted) * 255;
  if (shifted < 1 / 2) return q * 255;
  if (shifted < 2 / 3) return (p + (q - p) * (2 / 3 - shifted) * 6) * 255;
  return p * 255;
}

/**
 * Repaints the downloaded cone.
 *
 * The model's base colour map is a *red* cone with dull grey bands, authored
 * dark for a lit PBR renderer. Nothing in this scene lights it, so straight
 * onto an unlit material it comes out a muddy maroon — and no amount of
 * brightening turns red into the orange a traffic cone is actually painted.
 *
 * So the hue is replaced outright rather than adjusted. The two materials on
 * the cone separate cleanly by saturation: the painted body is strongly
 * coloured and becomes orange, the reflective bands are neutral grey and
 * become white. All the grime, wear and shading in the original survives,
 * because only hue and level are touched and the per-pixel variation is
 * carried through.
 */
export function recolourCone(source: CanvasImageSource, size = 1024): Texture {
  const { canvas, ctx } = createCanvas(size, size);
  ctx.drawImage(source, 0, 0, size, size);

  const image = ctx.getImageData(0, 0, size, size);
  const { data } = image;

  /** Safety orange. */
  const HUE = 0.068;
  const BODY_SATURATION = 0.95;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;

    const { lightness, saturation } = levels(data[index], data[index + 1], data[index + 2]);

    if (saturation < 0.2) {
      // Reflective band: neutral, and lifted close to white.
      const value = Math.min(255, Math.round((lightness * 0.85 + 0.34) * 255));
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      continue;
    }

    const target = Math.min(0.63, 0.28 + lightness * 0.78);
    const q = target < 0.5 ? target * (1 + BODY_SATURATION) : target + BODY_SATURATION - target * BODY_SATURATION;
    const p = 2 * target - q;
    data[index] = channel(p, q, HUE + 1 / 3);
    data[index + 1] = channel(p, q, HUE);
    data[index + 2] = channel(p, q, HUE - 1 / 3);
  }
  ctx.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  // flipY is deliberately left at its default. A canvas is drawn top-down and
  // a texture is sampled bottom-up, and three's default flip is exactly what
  // reconciles those — which is also what an image loaded through the normal
  // texture loader gets. Turning it off here sampled the atlas upside down and
  // painted the base-plate corner of the sheet onto the cone's flank, which is
  // why the reflective bands were nowhere near where they belong.
  return texture;
}
