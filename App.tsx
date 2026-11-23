import { StatusBar } from 'expo-status-bar';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { BlurLevel, MediaItem } from './src/lib/findings';
import { buildReport, type FindingKind } from './src/lib/report';
import { deleteItems, deviceStorage, scanLibrary, type ScanProgress } from './src/lib/scanner';
import HomeScreen from './src/screens/HomeScreen';
import ReviewScreen from './src/screens/ReviewScreen';

export default function App() {
  const [permission, requestPermission] = MediaLibrary.usePermissions({ granularPermissions: ['photo', 'video'] });
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [storage, setStorage] = useState<{ total: number; free: number } | null>(null);
  const [blurLevel, setBlurLevel] = useState<BlurLevel>('normal');
  const [screen, setScreen] = useState<FindingKind | null>(null);
  const cancelled = useRef(false);

  const report = useMemo(() => (items ? buildReport(items, blurLevel) : null), [items, blurLevel]);

  useEffect(() => {
    deviceStorage().then(setStorage);
  }, []);

  const startScan = useCallback(async () => {
    let perm = permission;
    if (!perm?.granted) perm = await requestPermission();
    if (!perm.granted) {
      Alert.alert('Accès refusé', "Autorise l'accès aux photos dans Réglages › Expo Go › Photos.");
      return;
    }
    cancelled.current = false;
    try {
      const result = await scanLibrary(setProgress, () => cancelled.current);
      if (!cancelled.current) setItems(result);
    } catch (e) {
      Alert.alert("Erreur pendant l'analyse", String(e));
    } finally {
      setProgress(null);
      deviceStorage().then(setStorage);
    }
  }, [permission, requestPermission]);

  const onDelete = useCallback(async (ids: string[]) => {
    try {
      const ok = await deleteItems(ids);
      if (!ok) return false;
      const gone = new Set(ids);
      setItems((prev) => prev?.filter((i) => !gone.has(i.id)) ?? null);
      deviceStorage().then(setStorage);
      return true;
    } catch {
      // The user tapped "Don't allow" on the iOS confirmation sheet.
      return false;
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {screen && report ? (
        <ReviewScreen
          kind={screen}
          report={report}
          blurLevel={blurLevel}
          onBlurLevel={setBlurLevel}
          onDelete={onDelete}
          onBack={() => setScreen(null)}
        />
      ) : (
        <HomeScreen
          permission={permission}
          progress={progress}
          report={report}
          storage={storage}
          onScan={startScan}
          onCancel={() => (cancelled.current = true)}
          onOpen={setScreen}
          onManageAccess={() => MediaLibrary.presentPermissionsPickerAsync(['photo', 'video'])}
        />
      )}
    </SafeAreaProvider>
  );
}
