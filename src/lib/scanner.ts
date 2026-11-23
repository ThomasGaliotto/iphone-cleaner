// Reads the photo library, measures file sizes and computes image metrics (with an on-device cache).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library/legacy';
// Import the decoder only: the package entry also loads the encoder, which needs Node's Buffer.
// @ts-ignore - no type declarations for this deep import
import decodeJpeg from 'jpeg-js/lib/decoder';

import type { MediaItem } from './findings';
import { base64ToBytes, computeMetrics, type ImageMetrics } from './imageMetrics';

const CACHE_KEY = 'scan-cache-v1';
const ANALYSIS_WIDTH = 256;
const CONCURRENCY = 3;

type CacheEntry = { mt: number; size: number; est: boolean; metrics?: ImageMetrics };
type Cache = Record<string, CacheEntry>;

export type ScanProgress = {
  phase: 'listing' | 'analyzing' | 'done';
  done: number;
  total: number;
};

async function loadCache(): Promise<Cache> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is a speed-up only; ignore storage errors.
  }
}

export async function clearCache() {
  await AsyncStorage.removeItem(CACHE_KEY);
}

/** Rough size when the original only lives in iCloud ("Optimize iPhone Storage"). */
function estimateSize(a: MediaLibrary.Asset): number {
  const px = a.width * a.height;
  if (a.mediaType === 'video') return Math.round(px * Math.max(1, a.duration) * 0.5);
  return Math.round(px * 0.2);
}

async function listAllAssets(onProgress: (n: number, total: number) => void): Promise<MediaLibrary.Asset[]> {
  const all: MediaLibrary.Asset[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await MediaLibrary.getAssetsAsync({
      first: 500,
      after,
      mediaType: ['photo', 'video'],
      sortBy: [['creationTime', false]],
    });
    all.push(...page.assets);
    onProgress(all.length, page.totalCount);
    if (!page.hasNextPage) break;
    after = page.endCursor;
  }
  return all;
}

async function fileSize(uri: string | undefined): Promise<number | null> {
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri.split('#')[0]);
    return info.exists && typeof info.size === 'number' ? info.size : null;
  } catch {
    return null;
  }
}

async function analyzeImage(uri: string): Promise<ImageMetrics | undefined> {
  const ctx = ImageManipulator.manipulate(uri, { maxWidth: ANALYSIS_WIDTH * 2 });
  let ref;
  try {
    ctx.resize({ width: ANALYSIS_WIDTH, height: null });
    ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
    FileSystem.deleteAsync(out.uri, { idempotent: true }).catch(() => {});
    if (!out.base64) return undefined;
    const img = decodeJpeg(base64ToBytes(out.base64), { useTArray: true, formatAsRGBA: true });
    return computeMetrics(img.data, img.width, img.height);
  } finally {
    ref?.release();
    ctx.release();
  }
}

async function processAsset(a: MediaLibrary.Asset, cache: Cache): Promise<MediaItem> {
  const base = {
    id: a.id,
    uri: a.uri,
    mediaType: a.mediaType === 'video' ? 'video' : 'photo',
    subtypes: (a.mediaSubtypes ?? []) as string[],
    width: a.width,
    height: a.height,
    duration: a.duration,
    creationTime: a.creationTime,
    filename: a.filename,
  } as const;

  const cached = cache[a.id];
  const needsMetrics = a.mediaType === 'photo';
  if (cached && cached.mt === a.modificationTime && (!needsMetrics || cached.metrics)) {
    return { ...base, size: cached.size, sizeEstimated: cached.est, metrics: cached.metrics };
  }

  let localUri: string | undefined;
  try {
    const info = await MediaLibrary.getAssetInfoAsync(a, { shouldDownloadFromNetwork: false });
    localUri = info.localUri ?? undefined;
  } catch {
    // iCloud-only or unavailable: fall back to estimates.
  }
  const real = await fileSize(localUri);
  const size = real ?? estimateSize(a);

  let metrics: ImageMetrics | undefined;
  if (needsMetrics) {
    for (const uri of [localUri, a.uri]) {
      if (!uri) continue;
      try {
        metrics = await analyzeImage(uri);
        if (metrics) break;
      } catch {
        // try the next source
      }
    }
  }

  cache[a.id] = { mt: a.modificationTime, size, est: real === null, metrics };
  return { ...base, size, sizeEstimated: real === null, metrics };
}

export async function scanLibrary(
  onProgress: (p: ScanProgress) => void,
  isCancelled: () => boolean,
): Promise<MediaItem[]> {
  onProgress({ phase: 'listing', done: 0, total: 0 });
  const assets = await listAllAssets((n, total) => onProgress({ phase: 'listing', done: n, total }));
  const cache = await loadCache();
  const results: MediaItem[] = new Array(assets.length);

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (!isCancelled()) {
      const i = next++;
      if (i >= assets.length) return;
      results[i] = await processAsset(assets[i], cache);
      done++;
      if (done % 25 === 0) onProgress({ phase: 'analyzing', done, total: assets.length });
      if (done % 300 === 0) await saveCache(cache);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Drop cache entries for assets that no longer exist.
  const alive = new Set(assets.map((a) => a.id));
  for (const id of Object.keys(cache)) if (!alive.has(id)) delete cache[id];
  await saveCache(cache);

  onProgress({ phase: 'done', done, total: assets.length });
  return results.filter(Boolean);
}

export async function deviceStorage(): Promise<{ total: number; free: number } | null> {
  try {
    const [total, free] = await Promise.all([
      FileSystem.getTotalDiskCapacityAsync(),
      FileSystem.getFreeDiskStorageAsync(),
    ]);
    return { total, free };
  } catch {
    return null;
  }
}

/** Shows the iOS confirmation sheet; items go to "Recently Deleted" (recoverable 30 days). */
export async function deleteItems(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false;
  return MediaLibrary.deleteAssetsAsync(ids);
}
