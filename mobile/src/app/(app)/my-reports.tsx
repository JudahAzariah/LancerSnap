import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDateTime, statusLabel } from '@/report/status';
import { fetchMyReports, type ReportSummary } from '@/report/tracking';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; reports: ReportSummary[] }
  | { status: 'error' };

/** My Reports (LS-10; US-03): the student's own reports, newest first. */
export default function MyReportsScreen() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const reports = await fetchMyReports();
      setState({ status: 'ready', reports });
    } catch {
      // Keep showing what was already loaded only if there is nothing to
      // replace it with; otherwise say plainly that loading failed.
      setState({ status: 'error' });
    }
  }, []);

  // Reload whenever the screen comes into view, so status changes show up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function retry() {
    setState({ status: 'loading' });
    void load();
  }

  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Loading your reports…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>
            Your reports could not be loaded. Check your connection and try again.
          </Text>
        </View>
        <View style={styles.gap}>
          <Button label="Try again" onPress={retry} variant="secondary" />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={state.reports}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={
        <View>
          <Text style={styles.heading}>No reports yet</Text>
          <Text style={styles.body}>Reports you submit will appear here with their status.</Text>
          <View style={styles.gap}>
            <Button label="Snap & Report" onPress={() => router.push('/report/new')} />
          </View>
        </View>
      }
      ListHeaderComponent={
        state.reports.length > 0 ? (
          <Text style={styles.body}>
            {state.reports.length === 1
              ? '1 report. Pull down to refresh.'
              : `${state.reports.length} reports. Pull down to refresh.`}
          </Text>
        ) : undefined
      }
      refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} />}
      renderItem={({ item }) => (
        <Pressable
          accessibilityHint="Opens the report details"
          accessibilityLabel={`Report ${item.reference_code}, ${item.location.name}, submitted ${formatDateTime(item.created_at)}, status ${statusLabel(item.status)}`}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/reports/[id]', params: { id: item.id } })}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.reference}>{item.reference_code}</Text>
            <StatusBadge status={item.status} />
          </View>
          <Text style={styles.location}>{item.location.name}</Text>
          <Text style={styles.meta}>Submitted {formatDateTime(item.created_at)}</Text>
        </Pressable>
      )}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center', gap: 12 },
  centered: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.background,
  },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text },
  body: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  gap: { marginTop: 16, alignSelf: 'stretch' },
  card: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  pressed: { opacity: 0.8 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reference: { fontSize: 17, fontWeight: '700', color: colors.text },
  location: { marginTop: 8, fontSize: 16, color: colors.text },
  meta: { marginTop: 4, fontSize: 14, color: colors.textMuted },
  error: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { fontSize: 15, lineHeight: 21, color: colors.error },
});
