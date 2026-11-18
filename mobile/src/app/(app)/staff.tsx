import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { ChoiceList } from '@/components/ChoiceList';
import { StatusBadge } from '@/components/StatusBadge';
import { priorityLabel } from '@/report/analysisLabels';
import { formatDateTime, statusLabel } from '@/report/status';
import { DEFAULT_FILTERS, fetchQueue, type QueueFilters, type QueueItem } from '@/staff/queue';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; items: QueueItem[] }
  | { status: 'error' };

const ALL = 'all';
const STATUSES = ['submitted', 'assigned', 'in_progress', 'resolved', 'reopened', 'closed'];

/**
 * Staff dashboard and team queue (LS-18; US-07, RC-01, RC-07, RC-11). Shows
 * only reports in the caller's team queues (administrators: all reports); the
 * backend enforces this. Safety hazards are marked in words and with a symbol,
 * never by color alone.
 */
export default function StaffQueueScreen() {
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    fetchQueue(filters)
      .then((items) => {
        if (active) setState({ status: 'ready', items });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [filters, attempt]);

  // Reload when coming back to the screen, so the queue shows current data.
  // The first focus is the initial load above, so it is skipped.
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) setAttempt((count) => count + 1);
      focusedBefore.current = true;
    }, []),
  );

  function update(change: Partial<QueueFilters>) {
    setState({ status: 'loading' });
    setFilters((current) => ({ ...current, ...change }));
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          onRefresh={() => {
            setRefreshing(true);
            setAttempt((count) => count + 1);
          }}
          refreshing={refreshing}
        />
      }
      style={styles.scroll}
    >
      <Text style={styles.body}>
        Reports in your team queues. Priority, category, and safety flags are AI suggestions until
        staff confirm them.
      </Text>

      <View style={styles.filters}>
        <ChoiceList
          label="Sort by"
          onSelect={(sort) => update({ sort: sort as QueueFilters['sort'] })}
          options={[
            { value: 'priority', label: 'Priority' },
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
          ]}
          selected={filters.sort}
        />
        <ChoiceList
          label="Status"
          onSelect={(value) => update({ status: value === ALL ? null : value })}
          options={[
            { value: ALL, label: 'All' },
            ...STATUSES.map((value) => ({ value, label: statusLabel(value) })),
          ]}
          selected={filters.status ?? ALL}
        />
        <ChoiceList
          label="Priority"
          onSelect={(value) =>
            update({ priority: value === ALL ? null : (value as QueueFilters['priority']) })
          }
          options={[
            { value: ALL, label: 'All' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
            { value: 'none', label: 'None suggested' },
          ]}
          selected={filters.priority ?? ALL}
        />
        <ChoiceList
          label="Safety hazards"
          onSelect={(value) => update({ hazardsOnly: value === 'only' })}
          options={[
            { value: 'all', label: 'Show all reports' },
            { value: 'only', label: 'Only potential safety hazards' },
          ]}
          selected={filters.hazardsOnly ? 'only' : 'all'}
        />
      </View>

      <QueueBody
        onRetry={() => {
          setState({ status: 'loading' });
          setAttempt((count) => count + 1);
        }}
        state={state}
        filtered={JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)}
      />
    </ScrollView>
  );
}

function QueueBody({
  state,
  filtered,
  onRetry,
}: {
  state: LoadState;
  filtered: boolean;
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Loading the queue…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.gap}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          The queue could not be loaded. Check your connection and try again.
        </Text>
        <View style={styles.gap}>
          <Button label="Try again" onPress={onRetry} variant="secondary" />
        </View>
      </View>
    );
  }
  if (state.items.length === 0) {
    return (
      <Text style={styles.empty}>
        {filtered
          ? 'No reports match these filters.'
          : 'No reports in your team queues. Reports appear here when they are routed to your team.'}
      </Text>
    );
  }
  return (
    <View>
      <Text style={styles.count}>
        {state.items.length} report{state.items.length === 1 ? '' : 's'}
      </Text>
      {state.items.map((item) => (
        <QueueCard key={item.id} item={item} />
      ))}
    </View>
  );
}

function QueueCard({ item }: { item: QueueItem }) {
  const priority = item.priority ? priorityLabel(item.priority) : null;
  const category = item.category
    ? `${item.category.name} (${item.category.source === 'staff' ? 'confirmed' : 'AI suggestion'})`
    : 'No category yet';
  const summary = [
    item.reference_code,
    statusLabel(item.status),
    item.potential_safety_hazard ? 'potential safety hazard' : null,
    priority?.text ?? 'no priority suggested',
    category,
    item.location_name,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityHint="Opens the report details"
      accessibilityLabel={summary}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/reports/[id]', params: { id: item.id } })}
      style={({ pressed }) => [
        styles.card,
        item.potential_safety_hazard && styles.hazardCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.reference}>{item.reference_code}</Text>
        <StatusBadge status={item.status} />
      </View>
      {item.potential_safety_hazard ? (
        <Text style={styles.hazard}>⚠ Potential safety hazard</Text>
      ) : null}
      <Text style={styles.priority}>
        {priority ? `${priority.symbol} ${priority.text}` : '– No priority suggested'}
      </Text>
      <Text style={styles.value}>Category: {category}</Text>
      {item.ai_uncertain ? <Text style={styles.value}>? AI was not sure</Text> : null}
      {item.in_manual_review ? <Text style={styles.value}>★ Waiting in manual review</Text> : null}
      <Text style={styles.meta}>
        {item.location_name}
        {item.team_name ? ` · ${item.team_name}` : ''}
      </Text>
      <Text style={styles.meta}>Submitted {formatDateTime(item.created_at)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 680, alignSelf: 'center' },
  body: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  filters: { marginTop: 8 },
  row: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  gap: { marginTop: 16 },
  errorText: { fontSize: 15, lineHeight: 21, color: colors.error },
  empty: { marginTop: 20, fontSize: 16, lineHeight: 22, color: colors.text },
  count: { marginTop: 20, fontSize: 15, fontWeight: '700', color: colors.text },
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  hazardCard: { borderWidth: 3, borderColor: colors.warningBorder },
  pressed: { opacity: 0.8 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reference: { fontSize: 18, fontWeight: '700', color: colors.text },
  hazard: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.warningBackground,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  priority: { marginTop: 8, fontSize: 16, fontWeight: '700', color: colors.text },
  value: { marginTop: 4, fontSize: 15, color: colors.textMuted },
  meta: { marginTop: 4, fontSize: 14, color: colors.textMuted },
});
