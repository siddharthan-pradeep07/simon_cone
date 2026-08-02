import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5174/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`[${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'shot-menu.png' });

await page.getByRole('button', { name: /^play$/i }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shot-launch.png' });
await page.waitForTimeout(3500);
await page.screenshot({ path: 'shot-run.png' });

console.log(problems.length ? problems.join('\n') : 'clean');
await browser.close();
