// Sanity checks for the pure analysis code: run with `npx tsx scripts/test-analysis.ts`.
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
// @ts-ignore
import decodeJpeg from 'jpeg-js/lib/decoder';
import { base64ToBytes, computeMetrics, hamming } from '../src/lib/imageMetrics';
import { findBlurry, findDark, findDuplicates, findSimilar, type MediaItem } from '../src/lib/findings';

const W = 256, H = 192;
function scene(seed: number, shift = 0): Uint8Array {
  // Textured scene: shapes + fine stripes.
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xx = x + shift;
    let v = 128 + 60 * Math.sin((xx * (0.3 + seed * 0.05))) * Math.cos(y * 0.21 + seed);
    if ((xx - 80 - seed * 20) ** 2 + (y - 90) ** 2 < 900) v = 30;
    if (xx > 150 && xx < 220 && y > 40 && y < 100) v = 230;
    const i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v)); d[i + 3] = 255;
  }
  return d;
}
function blur(src: Uint8Array, r: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = Math.min(W - 1, Math.max(0, x + dx)), Y = Math.min(H - 1, Math.max(0, y + dy));
      s += src[(Y * W + X) * 4]; n++;
    }
    const i = (y * W + x) * 4; out[i] = out[i + 1] = out[i + 2] = s / n; out[i + 3] = 255;
  }
  return out;
}
function darken(src: Uint8Array) { return src.map((v, i) => (i % 4 === 3 ? 255 : v * 0.08)); }
// Same pipeline as the app: JPEG -> base64 -> our decoder -> metrics.
function metricsViaJpeg(rgba: Uint8Array) {
  const b64 = jpeg.encode({ data: Buffer.from(rgba), width: W, height: H }, 90).data.toString('base64');
  const img = decodeJpeg(base64ToBytes(b64), { useTArray: true, formatAsRGBA: true });
  return computeMetrics(img.data, img.width, img.height);
}

const sharp = metricsViaJpeg(scene(1));
const recompressed = metricsViaJpeg(scene(1));
const soft = metricsViaJpeg(blur(scene(1), 4));
const other = metricsViaJpeg(scene(3));
const burst = metricsViaJpeg(blur(scene(1, 2), 1)); // slightly moved + softer: a realistic burst neighbour
const dark = metricsViaJpeg(darken(scene(2)));
console.log({ sharp: sharp.sharpness | 0, soft: soft.sharpness | 0, darkBrightness: dark.brightness | 0,
  dupDist: hamming(sharp.hash, recompressed.hash), burstDist: hamming(sharp.hash, burst.hash), blurDist: hamming(sharp.hash, soft.hash), otherDist: hamming(sharp.hash, other.hash) });

assert.ok(sharp.sharpness > 70, 'sharp image must not be flagged');
assert.ok(soft.sharpness < 35, 'blurred image must be flagged');
assert.equal(hamming(sharp.hash, recompressed.hash), 0);
assert.ok(hamming(sharp.hash, other.hash) > 12, 'different scenes must not match');
assert.ok(dark.brightness < 25);

const t0 = Date.parse('2026-06-01T12:00:00Z');
const mk = (id: string, metrics: any, dt: number, w = 4032): MediaItem => ({ id, uri: id, mediaType: 'photo', subtypes: [],
  width: w, height: (w * 3) / 4, duration: 0, creationTime: t0 + dt, filename: id, size: 2e6, sizeEstimated: false, metrics });
const items = [
  mk('a', sharp, 0), mk('a-copy', recompressed, 86_400_000 * 30, 2016), // copy one month later, lower res
  mk('b', burst, 1000), mk('c', other, 5000), mk('blurry', soft, 9e9), mk('dark', dark, 9.5e9),
];
const dups = findDuplicates(items);
assert.equal(dups.length, 1);
assert.deepEqual(new Set(dups[0].items), new Set(['a', 'a-copy']));
assert.equal(dups[0].keep, 'a', 'keeps the higher resolution copy');
const sim = findSimilar(items, new Set(dups[0].items));
assert.equal(sim.length, 0, 'b alone (a excluded) is not a group');
const sim2 = findSimilar(items, new Set());
assert.ok(sim2.some((g) => g.items.includes('a') && g.items.includes('b')), 'burst shots grouped');
assert.deepEqual(findBlurry(items, 'normal').map((i) => i.id), ['blurry']);
assert.deepEqual(findDark(items).map((i) => i.id), ['dark']);

// Performance: 20k photos grouping must stay fast.
const many: MediaItem[] = Array.from({ length: 20000 }, (_, i) => mk('p' + i,
  { ...sharp, hash: Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0') + Math.floor(Math.random() * 2 ** 32).toString(16).padStart(8, '0') }, i * 30_000));
let t = Date.now(); findDuplicates(many); findSimilar(many, new Set()); console.log('20k grouping ms', Date.now() - t);
console.log('OK');
