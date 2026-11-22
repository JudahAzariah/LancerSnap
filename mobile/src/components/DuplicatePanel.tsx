import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { formatDateTime, statusLabel } from '@/report/status';
import {
  type DuplicateCandidate,
  type DuplicateReviewState,
  duplicateReasons,
  duplicateStateLabel,
  fetchDuplicates,
  reviewDuplicate,
} from '@/staff/reportActions';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; candidates: DuplicateCandidate[] }
  | { status: 'error' };

/**
 * Possible duplicate reports, for staff (LS-19; RC-06, US-08). Each one links
 * to the other report and can be marked reviewed. A decision is only a record:
 * no report is merged, closed, or changed.
 */
export function DuplicatePanel({ reportId, refreshKey = 0 }: { reportId: string; refreshKey?: number }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchDuplicates(reportId)
      .then((candidates) => {
        if (active) setState({ status: 'ready', candidates });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [reportId, refreshKey, attempt]);

  function replace(updated: DuplicateCandidate) {
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            candidates: current.candidates.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>
        Possible duplicates (suggestion only)
      </Text>
      {state.status === 'loading' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.body}>Looking for possible duplicates…</Text>
        </View>
      ) : null}
      {state.status === 'error' ? (
        <View>
          <Text accessibilityRole="alert" style={styles.body}>
            Possible duplicates could not be loaded.
          </Text>
          <View style={styles.gap}>
            <Button
              label="Try again"
              onPress={() => {
                setState({ status: 'loading' });
                setAttempt((count) => count + 1);
              }}
              variant="secondary"
            />
          </View>
        </View>
      ) : null}
      {state.status === 'ready' && state.candidates.length === 0 ? (
        <Text style={styles.body}>No possible duplicates found.</Text>
      ) : null}
      {state.status === 'ready' && state.candidates.length > 0 ? (
        <>
          <Text style={styles.body}>
            Marking a report only records your decision. Both reports stay open and nothing is
            merged.
          </Text>
          {state.candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              onUpdated={replace}
              reportId={reportId}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function CandidateCard({
  reportId,
  candidate,
  onUpdated,
}: {
  reportId: string;
  candidate: DuplicateCandidate;
  onUpdated: (updated: DuplicateCandidate) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const other = candidate.other_report;
  const reasons = duplicateReasons(candidate.signals);

  async function decide(reviewState: DuplicateReviewState) {
    setSaving(true);
    setError(false);
    try {
      onUpdated(await reviewDuplicate(reportId, candidate.id, reviewState));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityHint="Opens the other report"
        accessibilityLabel={`Open ${other.reference_code}, ${statusLabel(other.status)}, ${other.location_name}`}
        accessibilityRole="link"
        onPress={() => router.push({ pathname: '/reports/[id]', params: { id: other.id } })}
      >
        <Text style={styles.link}>Open {other.reference_code} →</Text>
      </Pressable>
      <Text style={styles.meta}>
        {statusLabel(other.status)} · {other.location_name} · Submitted{' '}
        {formatDateTime(other.created_at)}
      </Text>
      {reasons.length > 0 ? (
        <Text style={styles.body}>Why it was suggested: {reasons.join(', ')}.</Text>
      ) : null}
      <Text accessibilityLiveRegion="polite" style={styles.state}>
        {duplicateStateLabel(candidate.review_state)}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          Your decision could not be saved. Try again.
        </Text>
      ) : null}
      {candidate.review_state === 'pending' ? (
        <View style={styles.actions}>
          <Button
            busy={saving}
            label="Same issue"
            onPress={() => decide('confirmed_duplicate')}
            variant="secondary"
          />
          <Button
            disabled={saving}
            label="Not a duplicate"
            onPress={() => decide('not_duplicate')}
            variant="secondary"
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            busy={saving}
            label="Undo decision"
            onPress={() => decide('pending')}
            variant="secondary"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 20,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  heading: { fontSize: 17, fontWeight: '700', color: colors.text },
  row: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  gap: { marginTop: 12 },
  body: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  meta: { marginTop: 4, fontSize: 14, color: colors.textMuted },
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  link: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  state: { marginTop: 8, fontSize: 15, fontWeight: '700', color: colors.text },
  errorText: { marginTop: 6, fontSize: 15, color: colors.error },
  actions: { marginTop: 10, gap: 8 },
});
