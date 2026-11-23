import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatBytes, type BlurLevel, type Group, type MediaItem } from '../lib/findings';
import { FINDING_INFO, type FindingKind, type Report } from '../lib/report';
import { colors } from '../ui/theme';

type Props = {
  kind: FindingKind;
  report: Report;
  blurLevel: BlurLevel;
  onBlurLevel: (l: BlurLevel) => void;
  onDelete: (ids: string[]) => Promise<boolean>;
  onBack: () => void;
};

const COLUMNS = 3;
const GAP = 4;

function initialSelection(kind: FindingKind, report: Report): Set<string> {
  const f = report.findings[kind];
  if ('groups' in f) return new Set(f.groups.flatMap((g) => g.items.filter((id) => id !== g.keep)));
  return new Set();
}

export default function ReviewScreen({ kind, report, blurLevel, onBlurLevel, onDelete, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const thumb = Math.floor((width - 32 - GAP * (COLUMNS - 1)) / COLUMNS);
  const finding = report.findings[kind];
  const info = FINDING_INFO[kind];

  const [selected, setSelected] = useState<Set<string>>(() => initialSelection(kind, report));
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the selection consistent when the report changes (after a deletion or a new blur level).
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => report.byId.has(id))));
  }, [report]);

  const allIds = useMemo(
    () => ('groups' in finding ? finding.groups.flatMap((g) => g.items.filter((id) => id !== g.keep)) : finding.items.map((i) => i.id)),
    [finding],
  );
  const selectedSize = useMemo(
    () => [...selected].reduce((s, id) => s + (report.byId.get(id)?.size ?? 0), 0),
    [selected, report],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const remove = async () => {
    setBusy(true);
    const ids = [...selected];
    const ok = await onDelete(ids);
    if (ok) setSelected(new Set());
    setBusy(false);
  };

  const renderThumb = (item: MediaItem, keep = false) => (
    <Thumb
      key={item.id}
      item={item}
      size={thumb}
      selected={selected.has(item.id)}
      keep={keep}
      onPress={() => toggle(item.id)}
      onLongPress={() => setPreview(item)}
    />
  );

  const header = (
    <View style={{ marginBottom: 12, gap: 6 }}>
      <Text style={styles.muted}>{info.subtitle}. Touchez pour (dé)sélectionner, appui long pour agrandir.</Text>
      {kind === 'blurry' && (
        <View style={styles.segment}>
          {(['strict', 'normal', 'large'] as BlurLevel[]).map((l) => (
            <Pressable key={l} onPress={() => onBlurLevel(l)} style={[styles.segmentItem, blurLevel === l && styles.segmentActive]}>
              <Text style={[styles.segmentText, blurLevel === l && { color: '#fff' }]}>
                {{ strict: 'Très flou', normal: 'Normal', large: 'Large' }[l]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {'groups' in finding && (
        <Text style={styles.muted}>La meilleure version de chaque groupe (résolution, netteté) est marquée « Garder ».</Text>
      )}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.navButton}>‹ Retour</Text>
        </Pressable>
        <Text style={styles.navTitle}>{info.title}</Text>
        <Pressable onPress={() => setSelected(allSelected ? new Set() : new Set(allIds))} hitSlop={12}>
          <Text style={styles.navButton}>{allSelected ? 'Aucun' : 'Tout'}</Text>
        </Pressable>
      </View>

      {'groups' in finding ? (
        <FlatList
          data={finding.groups}
          keyExtractor={(g) => g.keep}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={<Empty />}
          renderItem={({ item: g }) => <GroupView group={g} report={report} renderThumb={renderThumb} />}
        />
      ) : (
        <FlatList
          data={finding.items}
          keyExtractor={(i) => i.id}
          numColumns={COLUMNS}
          contentContainerStyle={styles.list}
          columnWrapperStyle={{ gap: GAP }}
          ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
          ListHeaderComponent={header}
          ListEmptyComponent={<Empty />}
          renderItem={({ item }) => renderThumb(item)}
        />
      )}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={[styles.deleteButton, (selected.size === 0 || busy) && { opacity: 0.4 }]} disabled={selected.size === 0 || busy} onPress={remove}>
          <Text style={styles.deleteText}>
            {selected.size === 0
              ? 'Rien de sélectionné'
              : `Supprimer ${selected.size.toLocaleString('fr-FR')} élément${selected.size > 1 ? 's' : ''} · ${formatBytes(selectedSize)}`}
          </Text>
        </Pressable>
      </View>

      <Modal visible={!!preview} animationType="fade" transparent onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBg} onPress={() => setPreview(null)}>
          {preview && (
            <>
              <Image source={{ uri: preview.uri }} style={{ width: '100%', height: '75%' }} contentFit="contain" />
              <Text style={styles.previewText}>
                {new Date(preview.creationTime).toLocaleString('fr-FR')} · {preview.width}×{preview.height} · {formatBytes(preview.size)}
                {preview.metrics ? ` · netteté ${Math.round(preview.metrics.sharpness)}` : ''}
              </Text>
            </>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

function GroupView({ group, report, renderThumb }: { group: Group; report: Report; renderThumb: (i: MediaItem, keep?: boolean) => React.ReactNode }) {
  const items = group.items.map((id) => report.byId.get(id)).filter((i): i is MediaItem => !!i);
  if (items.length < 2) return null; // the rest of the group was deleted
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>
        {new Date(items[0].creationTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
        {items.length} photos
      </Text>
      <View style={styles.groupGrid}>{items.map((i) => renderThumb(i, i.id === group.keep))}</View>
    </View>
  );
}

function Thumb({ item, size, selected, keep, onPress, onLongPress }: {
  item: MediaItem;
  size: number;
  selected: boolean;
  keep: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={{ width: size, height: size }}>
      <Image source={{ uri: item.uri }} style={styles.thumb} contentFit="cover" recyclingKey={item.id} />
      {selected && <View style={styles.selectedOverlay} />}
      <View style={[styles.check, selected && styles.checkOn]}>{selected && <Text style={styles.checkMark}>✓</Text>}</View>
      {keep && (
        <View style={styles.keepBadge}>
          <Text style={styles.badgeText}>Garder</Text>
        </View>
      )}
      <View style={styles.sizeBadge}>
        <Text style={styles.badgeText}>
          {item.mediaType === 'video' ? `${Math.floor(item.duration / 60)}:${String(Math.round(item.duration % 60)).padStart(2, '0')} · ` : ''}
          {formatBytes(item.size)}
        </Text>
      </View>
    </Pressable>
  );
}

function Empty() {
  return <Text style={[styles.muted, { textAlign: 'center', marginTop: 40 }]}>Rien à nettoyer ici 🎉</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  navButton: { color: colors.accent, fontSize: 17 },
  navTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  muted: { fontSize: 13, color: colors.muted },
  group: { backgroundColor: colors.card, borderRadius: 12, padding: 10, marginBottom: 12 },
  groupTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  groupGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  thumb: { width: '100%', height: '100%', borderRadius: 6, backgroundColor: colors.border },
  selectedOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,59,48,0.25)', borderRadius: 6 },
  check: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.danger },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  keepBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: colors.success, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  sizeBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 9, padding: 2 },
  segmentItem: { flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.text },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(242,242,247,0.95)' },
  deleteButton: { backgroundColor: colors.danger, borderRadius: 14, padding: 16, alignItems: 'center' },
  deleteText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  previewBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center', padding: 16, gap: 12 },
  previewText: { color: '#fff', fontSize: 13, textAlign: 'center' },
});
