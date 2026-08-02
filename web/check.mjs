import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5174/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`[error] ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.screenshot({ path: 'shot-menu.png' });

// Play, then sit still so the traffic aimed at the start lane connects.
await page.getByRole('button', { name: /^play$/i }).click();
await page.waitForTimeout(2600);

for (let shot = 1; shot <= 16; shot++) {
  await page.screenshot({ path: `shot-run${String(shot).padStart(2, '0')}.png` });
  await page.waitForTimeout(260);
}

await page.waitForTimeout(1500);
await page.screenshot({ path: 'shot-over.png' });

const menu = page.getByRole('button', { name: /^menu$/i });
if (await menu.count()) {
  await menu.click();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'shot-back.png' });
}

console.log(problems.length ? problems.join('\n') : 'clean');
await browser.close();
