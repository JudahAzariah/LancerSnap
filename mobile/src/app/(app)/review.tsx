import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChoiceList } from '@/components/ChoiceList';
import { ApiError } from '@/lib/api';
import { failureReason } from '@/report/analysisLabels';
import { formatDateTime } from '@/report/status';
import {
  fetchReviewQueue,
  type Option,
  retryAnalysis,
  type ReviewItem,
  reviewReasonText,
  routeReport,
} from '@/review/review';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; items: ReviewItem[]; categories: Option[]; teams: Option[] }
  | { status: 'error' };

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.detail) return error.detail;
  return 'That could not be done. Check your connection and try again.';
}

/**
 * Manual review (LS-17). Reports the AI could not route wait here for a
 * person, with the reason. A reviewer sets the category and sends the report
 * to the team that should handle it, or retries a failed AI analysis.
 */
export default function ReviewScreen() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<{ kind: 'error' | 'done'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchReviewQueue()
      .then((data) => {
        if (active) setState({ status: 'ready', ...data });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'done', text: done });
      reload();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Loading the review queue…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          The review queue could not be loaded.
        </Text>
        <View style={styles.gap}>
          <Button
            label="Try again"
            onPress={() => {
              setState({ status: 'loading' });
              reload();
            }}
            variant="secondary"
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      <Text style={styles.body}>
        These reports could not be routed automatically. Check each one, choose its category and
        the team that should handle it.
      </Text>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={message.kind === 'error' ? 'alert' : undefined}
          style={message.kind === 'error' ? styles.errorText : styles.doneText}
        >
          {message.kind === 'error' ? '✕ ' : '✓ '}
          {message.text}
        </Text>
      ) : null}
      {state.items.length === 0 ? (
        <Text style={styles.empty}>✓ Nothing is waiting for review.</Text>
      ) : null}
      {state.items.map((item) => (
        <ReviewCard
          key={item.id}
          busy={busy}
          categories={state.categories}
          item={item}
          onRetry={() =>
            run(() => retryAnalysis(item.id), `${item.reference_code} was sent for AI analysis again.`)
          }
          onRoute={(categoryId, teamId) =>
            run(() => routeReport(item.id, categoryId, teamId), `${item.reference_code} was routed.`)
          }
          teams={state.teams}
        />
      ))}
      <View style={styles.gap}>
        <Button label="Refresh" onPress={reload} variant="secondary" />
      </View>
    </ScrollView>
  );
}

function ReviewCard({
  item,
  categories,
  teams,
  busy,
  onRoute,
  onRetry,
}: {
  item: ReviewItem;
  categories: Option[];
  teams: Option[];
  busy: boolean;
  onRoute: (categoryId: string, teamId: string) => void;
  onRetry: () => void;
}) {
  const [routing, setRouting] = useState(false);
  const suggested = categories.find((c) => c.name === item.ai?.category)?.id ?? null;
  const [category, setCategory] = useState<string | null>(suggested);
  const [team, setTeam] = useState<string | null>(null);
  const aiPending = item.ai?.processing_status === 'pending';

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {item.reference_code}
      </Text>
      <Text style={styles.value}>
        {item.location_name} · Submitted {formatDateTime(item.created_at)}
      </Text>
      <Text style={styles.value}>Note: {item.note ?? 'No note added.'}</Text>
      <Text style={styles.reason}>? Why it is here: {reviewReasonText(item.review_reason)}</Text>
      {item.ai?.processing_status === 'failed' ? (
        <Text style={styles.value}>{failureReason(item.ai.error)}</Text>
      ) : null}
      {aiPending ? <Text style={styles.value}>… AI analysis in progress.</Text> : null}
      {item.ai?.category ? (
        <Text style={styles.value}>AI suggestion: {item.ai.category}</Text>
      ) : null}
      {item.ai?.uncertainty_reason ? (
        <Text style={styles.value}>AI note: {item.ai.uncertainty_reason}</Text>
      ) : null}

      {routing ? (
        <View>
          <ChoiceList
            label="Category"
            onSelect={setCategory}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            selected={category}
          />
          <ChoiceList
            label="Send to team"
            onSelect={setTeam}
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
            selected={team}
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        {routing ? (
          <>
            <Button
              disabled={busy || !category || !team}
              label="Confirm and route"
              onPress={() => {
                if (category && team) onRoute(category, team);
              }}
            />
            <Button label="Cancel" onPress={() => setRouting(false)} variant="secondary" />
          </>
        ) : (
          <Button disabled={busy} label="Route this report" onPress={() => setRouting(true)} />
        )}
        {item.review_reason === 'ai_failed' && !aiPending ? (
          <Button disabled={busy} label="Retry AI analysis" onPress={onRetry} variant="secondary" />
        ) : null}
        <Button
          label="Open report"
          onPress={() => router.push({ pathname: '/reports/[id]', params: { id: item.id } })}
          variant="secondary"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 640, alignSelf: 'center' },
  centered: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  body: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  empty: { marginTop: 20, fontSize: 16, color: colors.text },
  value: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  reason: { marginTop: 8, fontSize: 15, fontWeight: '700', color: colors.text },
  gap: { marginTop: 16 },
  errorText: { marginTop: 14, fontSize: 15, lineHeight: 21, color: colors.error },
  doneText: { marginTop: 14, fontSize: 15, color: colors.text },
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  actions: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
