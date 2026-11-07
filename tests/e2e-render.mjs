// End-to-end smoke test: drives the real app in headless Chrome and exports an MP4.
// Usage: npm run build && npx next start, then
//   CHROME_PATH=/path/to/chrome npm run test:e2e -- <workdir>
// <workdir>/media must contain clip1.mp4, clip2.mp4, clip3.mp4, photo1.jpg, photo2.jpg, music.mp3.
// Writes reel-test.mp4 and screenshots to <workdir>.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const S = process.argv[2];
if (!S) throw new Error('Pass a work directory.');
const M = `${S}/media`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const logs = [];
page.on('console', (m) => { if (['error', 'warn'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(process.env.APP_URL || 'http://localhost:3000', { waitUntil: 'load', timeout: 60000 });
await page.waitForSelector('input[type=file]', { timeout: 60000 });
const [mediaInput, musicInput] = await page.$$('input[type=file]');
await mediaInput.uploadFile(...['clip1.mp4', 'photo1.jpg', 'clip2.mp4', 'photo2.jpg', 'clip3.mp4'].map((f) => `${M}/${f}`));
await page.waitForFunction(() => document.querySelectorAll('.assets li').length === 5, { timeout: 60000 });
await musicInput.uploadFile(`${M}/music.mp3`);
await page.waitForFunction(() => /BPM|No clear beat/.test(document.body.innerText), { timeout: 60000 });
const bpmLine = await page.$eval('.card:nth-of-type(2) .hint', (e) => e.innerText);
await page.type('input[placeholder^="e.g. 48"]', 'Weekend in Zanzibar');
await page.type('input[placeholder^="e.g. Follow"]', 'Follow for part 2');
const buttons = (text) => page.evaluateHandle((t) => [...document.querySelectorAll('button')].find((b) => b.innerText.includes(t)), text);
await (await buttons('Make my reel')).click();
await page.waitForSelector('.player', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
const summary = await page.$eval('.card:has(.player) h2 em', (e) => e.innerText);
const notes = await page.$$eval('.notes li', (l) => l.map((x) => x.innerText));
await page.screenshot({ path: `${S}/screen-top.png` });
await page.evaluate(() => document.querySelector('.player').scrollIntoView());
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${S}/screen-preview.png` });
const t0 = Date.now();
await (await buttons('Export MP4')).click();
await page.waitForFunction(() => document.querySelector('video.result') || document.querySelector('.error'), { timeout: 900000, polling: 2000 });
const err = await page.$eval('.error', (e) => e.innerText).catch(() => null);
let saved = null;
if (!err) {
  const b64 = await page.evaluate(async () => {
    const blob = await (await fetch(document.querySelector('video.result').src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  saved = `${S}/reel-test.mp4`;
  fs.writeFileSync(saved, Buffer.from(b64, 'base64'));
  await page.evaluate(() => document.querySelector('video.result').scrollIntoView());
  await page.screenshot({ path: `${S}/screen-done.png` });
}
console.log(JSON.stringify({ bpmLine, summary, notes, renderSeconds: (Date.now() - t0) / 1000, err, saved, logs: logs.slice(0, 15) }, null, 2));
await browser.close();
