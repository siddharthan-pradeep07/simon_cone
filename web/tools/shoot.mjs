/**
 * Screenshots the game at points in its own timeline.
 *
 * The game clamps its frame delta, so under software rendering it runs in slow
 * motion — wall-clock waits land in the wrong place. Everything here is timed
 * against the game instead: the launch is measured once by waiting for the
 * "GO!" that fires when control is handed over, and the launch shots are then
 * taken at fractions of that measured length.
 *
 * Run against the dev server: `node tools/shoot.mjs`
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const OUT = 'tools/shots';
const SETTLE = 2500;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--use-angle=d3d11',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

page.on('console', (message) => {
  if (message.type() === 'error') console.log('  console error:', message.text());
});
page.on('pageerror', (error) => console.log('  page error:', error.message));

const open = async () => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(SETTLE);
};

const shoot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  shot', name);
};

const play = () => page.getByRole('button', { name: /^play$/i }).click();

const renderer = await page.evaluate?.(() => null).catch(() => null);
void renderer;

await open();

const info = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', info);

// How many frames a second the page actually manages, which is what decides
// how far behind wall-clock the game's own clock runs.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const started = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - started < 1500) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - started)));
      };
      requestAnimationFrame(tick);
    }),
);
console.log('fps:', fps);

await shoot('menu');

// Measure the launch once.
await play();
const startedAt = Date.now();
await page.waitForSelector('.shout', { timeout: 120000 });
const launchMs = Date.now() - startedAt;
console.log('launch took', launchMs, 'ms of wall clock');

await shoot('running');
await page.waitForTimeout(launchMs * 4);
await shoot('running-fast');

// Now re-run it and catch the launch in the middle.
for (const [name, fraction] of [
  ['launch-25', 0.25],
  ['launch-55', 0.55],
  ['launch-80', 0.8],
]) {
  await open();
  await play();
  await page.waitForTimeout(launchMs * fraction);
  await shoot(name);
}

await browser.close();
