import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { ApiError } from '@/lib/api';
import { locationTypeLabel } from '@/report/locations';
import { formatDateTime, statusDescription, statusLabel } from '@/report/status';
import {
  fetchPhotoUrl,
  fetchReport,
  type ReportCategory,
  type ReportDetails,
} from '@/report/tracking';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; report: ReportDetails }
  | { status: 'not-found' }
  | { status: 'error' };

type PhotoState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error' };

/** Report details (LS-10; US-03, RC-12): current status and its history. */
export default function ReportDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', report: await fetchReport(id) });
    } catch (error) {
      setState({ status: error instanceof ApiError && error.status === 404 ? 'not-found' : 'error' });
    }
  }, [id]);

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
        <Text style={styles.body}>Loading the report…</Text>
      </View>
    );
  }

  if (state.status === 'not-found' || state.status === 'error') {
    return (
      <View style={styles.centered}>
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>
            {state.status === 'not-found'
              ? 'This report could not be found.'
              : 'The report could not be loaded. Check your connection and try again.'}
          </Text>
        </View>
        {state.status === 'error' ? (
          <View style={styles.gap}>
            <Button label="Try again" onPress={retry} variant="secondary" />
          </View>
        ) : null}
      </View>
    );
  }

  const { report } = state;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} />}
      style={styles.scroll}
    >
      <Text accessibilityRole="header" style={styles.reference}>
        {report.reference_code}
      </Text>

      <View accessibilityLiveRegion="polite" style={styles.statusBox}>
        <Text style={styles.label}>Current status</Text>
        <View style={styles.gapSmall}>
          <StatusBadge status={report.status} />
        </View>
        <Text style={styles.body}>{statusDescription(report.status)}</Text>
      </View>

      {/* Near the top, so it is seen without scrolling past the photo. */}
      {report.category ? <CategoryField category={report.category} /> : null}

      <Text style={styles.label}>Photo</Text>
      {report.media_id ? <ReportPhoto mediaId={report.media_id} /> : <Text style={styles.body}>No photo.</Text>}

      <Text style={styles.label}>Location</Text>
      <Text style={styles.value}>
        {report.location.name} ({locationTypeLabel(report.location.location_type)})
      </Text>

      <Text style={styles.label}>Note</Text>
      <Text style={styles.value}>{report.note ?? 'No note added.'}</Text>

      <Text style={styles.label}>Submitted on</Text>
      <Text style={styles.value}>{formatDateTime(report.created_at)}</Text>

      <Text accessibilityRole="header" style={styles.sectionHeading}>
        Status history
      </Text>
      {[...report.history].reverse().map((change, index) => (
        <View
          key={`${change.created_at}-${index}`}
          accessible
          style={styles.historyItem}
        >
          <Text style={styles.historyStatus}>{statusLabel(change.to_status)}</Text>
          <Text style={styles.meta}>{formatDateTime(change.created_at)}</Text>
          {change.note ? <Text style={styles.value}>{change.note}</Text> : null}
        </View>
      ))}
      <Text style={styles.meta}>Pull down to refresh.</Text>
    </ScrollView>
  );
}

/**
 * The report's category (LS-13; US-02). An AI suggestion is always labelled
 * in words as a suggestion that staff may change; it is never shown as fact.
 */
function CategoryField({ category }: { category: ReportCategory }) {
  if (category.source === 'staff') {
    return (
      <View accessible accessibilityLabel={`Category: ${category.name}, confirmed by campus staff`}>
        <Text style={styles.label}>Category</Text>
        <Text style={styles.value}>{category.name}</Text>
        <Text style={styles.meta}>Confirmed by campus staff.</Text>
      </View>
    );
  }
  const explanation = category.uncertain
    ? 'The AI was not sure about this. Campus staff will confirm or change it.'
    : 'Campus staff will confirm or change it.';
  return (
    <View
      accessible
      accessibilityLabel={`Category: ${category.name}. AI suggestion. ${explanation}`}
    >
      <Text style={styles.label}>Category</Text>
      <View style={styles.categoryRow}>
        <Text style={styles.aiTag}>AI suggestion</Text>
        <Text style={styles.value}>{category.name}</Text>
      </View>
      <Text style={styles.meta}>{explanation}</Text>
    </View>
  );
}

/** The report's photo, fetched through a short-lived signed link. */
function ReportPhoto({ mediaId }: { mediaId: string }) {
  const [photo, setPhoto] = useState<PhotoState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchPhotoUrl(mediaId)
      .then((url) => {
        if (active) setPhoto({ status: 'ready', url });
      })
      .catch(() => {
        if (active) setPhoto({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [mediaId, attempt]);

  if (photo.status === 'loading') {
    return (
      <View style={[styles.photo, styles.photoPlaceholder]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.meta}>Loading photo…</Text>
      </View>
    );
  }
  if (photo.status === 'error') {
    return (
      <View style={[styles.photo, styles.photoPlaceholder]}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          The photo could not be loaded.
        </Text>
        <Button
          label="Try again"
          onPress={() => {
            setPhoto({ status: 'loading' });
            setAttempt((count) => count + 1);
          }}
          variant="secondary"
        />
      </View>
    );
  }
  return (
    <Image
      accessibilityLabel="The photo submitted with this report"
      accessible
      onError={() => setPhoto({ status: 'error' })}
      resizeMode="contain"
      source={{ uri: photo.url }}
      style={styles.photo}
    />
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  centered: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  reference: { fontSize: 26, fontWeight: '700', color: colors.text },
  statusBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  label: { marginTop: 20, fontSize: 15, fontWeight: '700', color: colors.text },
  sectionHeading: { marginTop: 28, fontSize: 18, fontWeight: '700', color: colors.text },
  value: { marginTop: 6, fontSize: 16, lineHeight: 22, color: colors.textMuted },
  body: { marginTop: 8, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  meta: { marginTop: 4, fontSize: 14, color: colors.textMuted },
  gap: { marginTop: 16, alignSelf: 'stretch' },
  gapSmall: { marginTop: 8 },
  photo: {
    marginTop: 8,
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  historyItem: {
    marginTop: 10,
    paddingLeft: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
  },
  historyStatus: { fontSize: 16, fontWeight: '700', color: colors.text },
  categoryRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  aiTag: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  error: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { fontSize: 15, lineHeight: 21, color: colors.error },
});
