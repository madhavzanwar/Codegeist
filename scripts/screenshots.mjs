// Renders the Custom UI against the mock bridge (real risk engine + demo dataset) and saves screenshots.
// Usage: npm run screenshots   (builds static/app in mock mode first)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
execSync('npx vite build --mode mock', { cwd: join(root, 'static/app'), stdio: 'inherit' });
const dir = join(root, 'static/app/build-mock');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    const body = await readFile(join(dir, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'Content-Type': types[extname(path) || '.html'] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;
const out = join(root, 'docs/screenshots');
execSync(`mkdir -p ${out}`);
const browser = await chromium.launch();
const shots = [
  { name: 'dashboard', q: '', w: 1360, h: 1000, scheme: 'light' },
  { name: 'dashboard-dark', q: '', w: 1360, h: 1000, scheme: 'dark' },
  { name: 'issue-panel', q: '?module=sprint-sentinel-issue-panel', w: 720, h: 420, scheme: 'light' },
  { name: 'confluence-overview', q: '?module=sprint-sentinel-confluence-page', w: 1200, h: 520, scheme: 'light' },
];
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, colorScheme: s.scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/${s.q}`);
  await page.waitForTimeout(700);
  if (s.name === 'dashboard') {
    await page.screenshot({ path: join(out, `${s.name}.png`), fullPage: true });
    await page.locator('.risk-head').first().click();
    await page.waitForTimeout(200);
    await page.locator('.risk-item').first().screenshot({ path: join(out, 'risk-evidence.png') });
    await page.getByRole('button', { name: 'Flag', exact: true }).first().click();
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, 'confirm-modal.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /Findings/ }).click();
    await page.waitForTimeout(150);
    await page.locator('section[aria-label="Risks"]').screenshot({ path: join(out, 'findings.png') });
  } else {
    await page.screenshot({ path: join(out, `${s.name}.png`), fullPage: true });
  }
  if (errors.length) console.error(s.name, errors);
  await page.close();
}
await browser.close();
server.close();
console.log(`Screenshots written to ${out}`);
