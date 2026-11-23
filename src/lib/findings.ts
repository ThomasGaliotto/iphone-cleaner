// Pure analysis of scanned media: storage breakdown, duplicates, similar shots, blurry/dark photos.
import { hamming, type ImageMetrics } from './imageMetrics';

export type MediaItem = {
  id: string;
  uri: string; // ph:// on iOS, usable by expo-image
  mediaType: 'photo' | 'video';
  subtypes: string[];
  width: number;
  height: number;
  duration: number; // seconds (videos)
  creationTime: number; // ms
  filename: string;
  size: number; // bytes
  sizeEstimated: boolean; // true when the original is only in iCloud
  metrics?: ImageMetrics;
};

export type Category = 'photo' | 'video' | 'screenshot' | 'livePhoto';

export const CATEGORY_LABELS: Record<Category, string> = {
  photo: 'Photos',
  livePhoto: 'Live Photos',
  screenshot: "Captures d'écran",
  video: 'Vidéos',
};

export function categoryOf(item: MediaItem): Category {
  if (item.mediaType === 'video') return 'video';
  if (item.subtypes.includes('screenshot')) return 'screenshot';
  if (item.subtypes.includes('livePhoto')) return 'livePhoto';
  return 'photo';
}

export type CategoryStat = { category: Category; count: number; size: number };

export function storageBreakdown(items: MediaItem[]): CategoryStat[] {
  const stats = new Map<Category, CategoryStat>();
  for (const c of Object.keys(CATEGORY_LABELS) as Category[]) stats.set(c, { category: c, count: 0, size: 0 });
  for (const it of items) {
    const s = stats.get(categoryOf(it))!;
    s.count++;
    s.size += it.size;
  }
  return [...stats.values()].sort((a, b) => b.size - a.size);
}

/** A set of near-identical items; `keep` is the one we suggest keeping. */
export type Group = { keep: string; items: string[] };

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Sharpness is measured on same-size thumbnails, so true copies have comparable values. */
function similarSharpness(a: MediaItem, b: MediaItem): boolean {
  const sa = a.metrics!.sharpness;
  const sb = b.metrics!.sharpness;
  return Math.min(sa, sb) * 3 >= Math.max(sa, sb);
}

function sameShape(a: MediaItem, b: MediaItem): boolean {
  const ra = a.width / Math.max(1, a.height);
  const rb = b.width / Math.max(1, b.height);
  return Math.abs(ra - rb) / Math.max(ra, rb) < 0.02;
}

/** Best copy = highest resolution, then sharpest, then oldest (likely the original). */
function pickKeeper(group: MediaItem[]): MediaItem {
  return [...group].sort(
    (a, b) =>
      b.width * b.height - a.width * a.height ||
      (b.metrics?.sharpness ?? 0) - (a.metrics?.sharpness ?? 0) ||
      a.creationTime - b.creationTime,
  )[0];
}

function toGroups(uf: UnionFind, byId: Map<string, MediaItem>, members: Iterable<string>): Group[] {
  const buckets = new Map<string, MediaItem[]>();
  for (const id of members) {
    const root = uf.find(id);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root)!.push(byId.get(id)!);
  }
  const groups: Group[] = [];
  for (const g of buckets.values()) {
    if (g.length < 2) continue;
    const keep = pickKeeper(g);
    g.sort((a, b) => a.creationTime - b.creationTime);
    groups.push({ keep: keep.id, items: g.map((x) => x.id) });
  }
  return groups;
}

export const DUPLICATE_MAX_DISTANCE = 3;
export const SIMILAR_MAX_DISTANCE = 12;
export const SIMILAR_TIME_WINDOW_MS = 2 * 60 * 1000;

/**
 * Duplicates: visually identical photos anywhere in the library.
 * Uses banding (4 x 16 bits): two hashes within distance 3 share at least one identical band.
 */
export function findDuplicates(photos: MediaItem[]): Group[] {
  const hashed = photos.filter((p) => p.metrics);
  const byId = new Map(hashed.map((p) => [p.id, p]));
  const uf = new UnionFind();
  const members = new Set<string>();
  for (let band = 0; band < 4; band++) {
    const buckets = new Map<string, MediaItem[]>();
    for (const p of hashed) {
      const key = p.metrics!.hash.slice(band * 4, band * 4 + 4);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(p);
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      // Guard against huge buckets (e.g. many black photos): compare a bounded neighbourhood.
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < Math.min(bucket.length, i + 300); j++) {
          const a = bucket[i];
          const b = bucket[j];
          if (sameShape(a, b) && similarSharpness(a, b) && hamming(a.metrics!.hash, b.metrics!.hash) <= DUPLICATE_MAX_DISTANCE) {
            uf.union(a.id, b.id);
            members.add(a.id).add(b.id);
          }
        }
      }
    }
  }
  return toGroups(uf, byId, members);
}

/** Similar: bursts / repeated shots of the same scene taken within a couple of minutes. */
export function findSimilar(photos: MediaItem[], exclude: Set<string>): Group[] {
  const sorted = photos
    .filter((p) => p.metrics && !exclude.has(p.id) && !p.subtypes.includes('screenshot'))
    .sort((a, b) => a.creationTime - b.creationTime);
  const byId = new Map(sorted.map((p) => [p.id, p]));
  const uf = new UnionFind();
  const members = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.creationTime - a.creationTime > SIMILAR_TIME_WINDOW_MS) break;
      if (hamming(a.metrics!.hash, b.metrics!.hash) <= SIMILAR_MAX_DISTANCE) {
        uf.union(a.id, b.id);
        members.add(a.id).add(b.id);
      }
    }
  }
  return toGroups(uf, byId, members);
}

export type BlurLevel = 'strict' | 'normal' | 'large';
/** Laplacian-variance thresholds measured on 256px-wide thumbnails. */
export const BLUR_THRESHOLDS: Record<BlurLevel, number> = { strict: 15, normal: 35, large: 70 };

export function findBlurry(photos: MediaItem[], level: BlurLevel): MediaItem[] {
  const t = BLUR_THRESHOLDS[level];
  return photos
    .filter(
      (p) =>
        p.metrics &&
        !p.subtypes.includes('screenshot') &&
        p.metrics.brightness >= 25 && // dark ones are listed separately
        p.metrics.sharpness < t,
    )
    .sort((a, b) => a.metrics!.sharpness - b.metrics!.sharpness);
}

export function findDark(photos: MediaItem[]): MediaItem[] {
  return photos
    .filter((p) => p.metrics && p.metrics.brightness < 25)
    .sort((a, b) => a.metrics!.brightness - b.metrics!.brightness);
}

export const BIG_VIDEO_BYTES = 50 * 1024 * 1024;

export function findBigVideos(items: MediaItem[]): MediaItem[] {
  return items.filter((v) => v.mediaType === 'video' && v.size >= BIG_VIDEO_BYTES).sort((a, b) => b.size - a.size);
}

export function findScreenshots(items: MediaItem[]): MediaItem[] {
  return items.filter((i) => categoryOf(i) === 'screenshot').sort((a, b) => a.creationTime - b.creationTime);
}

/** Bytes freed by deleting every non-kept item of each group. */
export function groupsReclaimable(groups: Group[], byId: Map<string, MediaItem>): number {
  let total = 0;
  for (const g of groups) for (const id of g.items) if (id !== g.keep) total += byId.get(id)?.size ?? 0;
  return total;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} ${units[u]}`;
}
