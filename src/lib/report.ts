// Builds everything the screens display from the scanned items.
import {
  findBigVideos,
  findBlurry,
  findDark,
  findDuplicates,
  findScreenshots,
  findSimilar,
  groupsReclaimable,
  storageBreakdown,
  type BlurLevel,
  type CategoryStat,
  type Group,
  type MediaItem,
} from './findings';

export type FindingKind = 'duplicates' | 'similar' | 'blurry' | 'dark' | 'screenshots' | 'bigVideos';

export type Finding =
  | { kind: 'duplicates' | 'similar'; groups: Group[]; count: number; reclaimable: number }
  | { kind: 'blurry' | 'dark' | 'screenshots' | 'bigVideos'; items: MediaItem[]; count: number; reclaimable: number };

export const FINDING_INFO: Record<FindingKind, { title: string; subtitle: string; icon: string }> = {
  duplicates: { title: 'Doublons', subtitle: 'Copies identiques de la même photo', icon: '⧉' },
  similar: { title: 'Photos similaires', subtitle: 'Rafales et prises répétées à quelques secondes', icon: '≈' },
  blurry: { title: 'Photos floues', subtitle: 'Peu ou pas de netteté détectée', icon: '◌' },
  dark: { title: 'Photos trop sombres', subtitle: 'Prises dans la poche, écran noir…', icon: '◐' },
  screenshots: { title: "Captures d'écran", subtitle: 'Souvent inutiles après coup', icon: '▢' },
  bigVideos: { title: 'Grosses vidéos', subtitle: 'Plus de 50 Mo chacune', icon: '▶' },
};

export type Report = {
  byId: Map<string, MediaItem>;
  breakdown: CategoryStat[];
  totalSize: number;
  estimatedCount: number;
  analyzedPhotos: number;
  findings: Record<FindingKind, Finding>;
};

const sum = (items: MediaItem[]) => items.reduce((s, i) => s + i.size, 0);

export function buildReport(items: MediaItem[], blurLevel: BlurLevel): Report {
  const byId = new Map(items.map((i) => [i.id, i]));
  const photos = items.filter((i) => i.mediaType === 'photo');
  const duplicates = findDuplicates(photos);
  const inDuplicates = new Set(duplicates.flatMap((g) => g.items));
  const similar = findSimilar(photos, inDuplicates);
  const blurry = findBlurry(photos, blurLevel);
  const dark = findDark(photos);
  const screenshots = findScreenshots(items);
  const bigVideos = findBigVideos(items);
  const groupCount = (gs: Group[]) => gs.reduce((s, g) => s + g.items.length - 1, 0);

  return {
    byId,
    breakdown: storageBreakdown(items),
    totalSize: sum(items),
    estimatedCount: items.filter((i) => i.sizeEstimated).length,
    analyzedPhotos: photos.filter((p) => p.metrics).length,
    findings: {
      duplicates: { kind: 'duplicates', groups: duplicates, count: groupCount(duplicates), reclaimable: groupsReclaimable(duplicates, byId) },
      similar: { kind: 'similar', groups: similar, count: groupCount(similar), reclaimable: groupsReclaimable(similar, byId) },
      blurry: { kind: 'blurry', items: blurry, count: blurry.length, reclaimable: sum(blurry) },
      dark: { kind: 'dark', items: dark, count: dark.length, reclaimable: sum(dark) },
      screenshots: { kind: 'screenshots', items: screenshots, count: screenshots.length, reclaimable: sum(screenshots) },
      bigVideos: { kind: 'bigVideos', items: bigVideos, count: bigVideos.length, reclaimable: sum(bigVideos) },
    },
  };
}
