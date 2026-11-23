import type { PermissionResponse } from 'expo-media-library/legacy';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CATEGORY_LABELS, formatBytes } from '../lib/findings';
import { FINDING_INFO, type FindingKind, type Report } from '../lib/report';
import type { ScanProgress } from '../lib/scanner';
import { colors } from '../ui/theme';

type Props = {
  permission: PermissionResponse | null;
  progress: ScanProgress | null;
  report: Report | null;
  storage: { total: number; free: number } | null;
  onScan: () => void;
  onCancel: () => void;
  onOpen: (kind: FindingKind) => void;
  onManageAccess: () => void;
};

const ORDER: FindingKind[] = ['duplicates', 'similar', 'blurry', 'dark', 'screenshots', 'bigVideos'];

export default function HomeScreen({ permission, progress, report, storage, onScan, onCancel, onOpen, onManageAccess }: Props) {
  const insets = useSafeAreaInsets();
  const totalReclaimable = report ? ORDER.reduce((s, k) => s + report.findings[k].reclaimable, 0) : 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}>
      <Text style={styles.title}>Nettoyeur</Text>

      {storage && <DeviceStorage storage={storage} photosSize={report?.totalSize} />}

      {permission?.accessPrivileges === 'limited' && (
        <Pressable style={styles.notice} onPress={onManageAccess}>
          <Text style={styles.noticeText}>
            Accès limité à certaines photos : l'analyse sera incomplète. Touchez pour modifier la sélection, ou passez à
            « Accès complet » dans Réglages.
          </Text>
        </Pressable>
      )}

      {progress ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{progress.phase === 'listing' ? 'Inventaire de la photothèque…' : 'Analyse des photos…'}</Text>
          <ProgressBar value={progress.total ? progress.done / progress.total : 0} />
          <Text style={styles.muted}>
            {progress.done.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')}
            {progress.phase === 'analyzing' ? ' — la première analyse est la plus longue, les suivantes utilisent le cache.' : ''}
          </Text>
          <Pressable onPress={onCancel} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Arrêter</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.primaryButton} onPress={onScan}>
          <Text style={styles.primaryButtonText}>{report ? 'Relancer l’analyse' : 'Analyser mes photos'}</Text>
        </Pressable>
      )}

      {report && (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Espace par catégorie</Text>
            <StackedBar
              parts={report.breakdown.map((b) => ({ value: b.size, color: colors.categories[b.category] }))}
            />
            {report.breakdown.map((b) => (
              <View key={b.category} style={styles.legendRow}>
                <View style={[styles.dot, { backgroundColor: colors.categories[b.category] }]} />
                <Text style={styles.legendLabel}>{CATEGORY_LABELS[b.category]}</Text>
                <Text style={styles.muted}>{b.count.toLocaleString('fr-FR')} · </Text>
                <Text style={styles.legendValue}>{formatBytes(b.size)}</Text>
              </View>
            ))}
            <Text style={[styles.muted, { marginTop: 8 }]}>
              Total photothèque : {formatBytes(report.totalSize)}
              {report.estimatedCount > 0 &&
                ` (dont ${report.estimatedCount.toLocaleString('fr-FR')} éléments stockés sur iCloud, taille estimée)`}
            </Text>
          </View>

          <Text style={styles.section}>
            À nettoyer · jusqu'à {formatBytes(totalReclaimable)} récupérables
          </Text>
          {ORDER.map((kind) => {
            const f = report.findings[kind];
            const info = FINDING_INFO[kind];
            return (
              <Pressable key={kind} style={styles.row} onPress={() => onOpen(kind)} disabled={f.count === 0}>
                <Text style={styles.rowIcon}>{info.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{info.title}</Text>
                  <Text style={styles.muted}>{info.subtitle}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.rowTitle, f.count === 0 && { color: colors.success }]}>
                    {f.count === 0 ? '✓' : f.count.toLocaleString('fr-FR')}
                  </Text>
                  {f.count > 0 && <Text style={styles.muted}>{formatBytes(f.reclaimable)}</Text>}
                </View>
              </Pressable>
            );
          })}
          <Text style={[styles.muted, styles.footnote]}>
            Photos analysées : {report.analyzedPhotos.toLocaleString('fr-FR')}. Les éléments supprimés vont dans « Supprimés
            récemment » (récupérables 30 jours) : videz cet album dans Photos pour libérer réellement l'espace.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function DeviceStorage({ storage, photosSize }: { storage: { total: number; free: number }; photosSize?: number }) {
  const used = storage.total - storage.free;
  const photos = Math.min(photosSize ?? 0, used);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Stockage de l'iPhone</Text>
      <StackedBar
        parts={[
          { value: photos, color: colors.categories.photo },
          { value: used - photos, color: '#8E8E93' },
          { value: storage.free, color: colors.border },
        ]}
      />
      <Text style={styles.muted}>
        {formatBytes(used)} utilisés sur {formatBytes(storage.total)} · {formatBytes(storage.free)} libres
        {photosSize ? ` · photothèque ${formatBytes(photosSize)}` : ''}
      </Text>
    </View>
  );
}

function StackedBar({ parts }: { parts: { value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <View style={styles.bar}>
      {parts.map((p, i) => (
        <View key={i} style={{ flex: p.value / total, backgroundColor: p.color }} />
      ))}
    </View>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.bar}>
      <View style={{ flex: value, backgroundColor: colors.accent }} />
      <View style={{ flex: 1 - value }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  title: { fontSize: 34, fontWeight: '700', color: colors.text, marginBottom: 16 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 16, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  bar: { height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', backgroundColor: colors.border },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  legendLabel: { flex: 1, fontSize: 15, color: colors.text },
  legendValue: { fontSize: 15, fontWeight: '600', color: colors.text, minWidth: 70, textAlign: 'right' },
  primaryButton: { backgroundColor: colors.accent, borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 16 },
  primaryButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondaryButton: { alignSelf: 'flex-start', paddingVertical: 6 },
  secondaryButtonText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  notice: { backgroundColor: '#FFF4E5', borderRadius: 12, padding: 12, marginBottom: 16 },
  noticeText: { color: '#8A5300', fontSize: 13 },
  section: { fontSize: 13, color: colors.muted, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: { fontSize: 22, width: 28, textAlign: 'center', color: colors.accent },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  footnote: { marginTop: 8, marginHorizontal: 4 },
});
