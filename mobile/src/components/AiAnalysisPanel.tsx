import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { confidenceLabel, failureReason, priorityLabel } from '@/report/analysisLabels';
import { type Analysis, fetchAnalysis } from '@/report/tracking';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; analysis: Analysis | null }
  | { status: 'error' };

/**
 * The AI analysis of a report, for staff and administrators (LS-14; RC-02,
 * RC-03, RC-07, RC-08, RC-10, RC-11).
 *
 * Everything is labelled as a suggestion. Priority, safety hazards,
 * uncertainty, and failures are each stated in words with a symbol, never by
 * color alone. A failed or missing analysis says so plainly, so it is never
 * mistaken for "no priority".
 */
export function AiAnalysisPanel({
  reportId,
  refreshKey = 0,
}: {
  reportId: string;
  /** Changes whenever the screen reloads, so the panel reloads with it. */
  refreshKey?: number;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchAnalysis(reportId)
      .then((analysis) => {
        if (active) setState({ status: 'ready', analysis });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [reportId, refreshKey, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>
        AI analysis (suggestion only)
      </Text>
      <Body retry={retry} state={state} />
    </View>
  );
}

function Body({ state, retry }: { state: LoadState; retry: () => void }) {
  if (state.status === 'loading') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Loading the AI analysis…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View>
        <Text accessibilityRole="alert" style={styles.body}>
          The AI analysis could not be loaded.
        </Text>
        <View style={styles.gap}>
          <Button label="Try again" onPress={retry} variant="secondary" />
        </View>
      </View>
    );
  }

  const { analysis } = state;
  if (analysis === null) {
    return (
      <Notice
        symbol="○"
        title="Not analyzed by AI"
        text="No priority or category was suggested. A person needs to review this report."
      />
    );
  }
  if (analysis.processing_status === 'pending') {
    return (
      <Notice
        symbol="…"
        title="AI analysis in progress"
        text="No suggestion yet. Pull down to refresh."
      />
    );
  }
  if (analysis.processing_status === 'failed') {
    return (
      <Notice
        symbol="✕"
        title="AI analysis failed"
        text={`${failureReason(analysis.error)} No priority or category was suggested, so a person needs to review this report.`}
        alert
      />
    );
  }

  const priority = analysis.priority ? priorityLabel(analysis.priority) : null;
  return (
    <View>
      {analysis.potential_safety_hazard ? (
        <View accessible accessibilityRole="alert" style={styles.hazard}>
          <Text style={styles.hazardTitle}>⚠ Potential safety hazard: needs human attention</Text>
          <Text style={styles.hazardBody}>
            Suggested by AI. LancerSnap does not contact emergency services. If someone is in
            danger, call 911 or contact campus safety directly.
          </Text>
        </View>
      ) : null}

      {priority ? (
        <Text accessibilityLabel={`Suggested priority: ${priority.text}`} style={styles.priority}>
          {priority.symbol} {priority.text}
        </Text>
      ) : null}

      {analysis.uncertain ? (
        <View accessible style={styles.uncertain}>
          <Text style={styles.uncertainTitle}>? Uncertain result</Text>
          {analysis.uncertainty_reason ? (
            <Text style={styles.body}>{analysis.uncertainty_reason}</Text>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.label}>Suggested category</Text>
      <Text style={styles.value}>{analysis.category?.name ?? 'None suggested'}</Text>
      {analysis.confidence !== null ? (
        <Text style={styles.meta}>{confidenceLabel(analysis.confidence)}</Text>
      ) : null}

      {analysis.summary ? (
        <>
          <Text style={styles.label}>Summary</Text>
          <Text style={styles.value}>{analysis.summary}</Text>
        </>
      ) : null}

      {analysis.details && analysis.details.length > 0 ? (
        <>
          <Text style={styles.label}>Details</Text>
          {analysis.details.map((detail, index) => (
            <Text key={`${index}-${detail}`} style={styles.value}>
              • {detail}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Notice({
  symbol,
  title,
  text,
  alert = false,
}: {
  symbol: string;
  title: string;
  text: string;
  alert?: boolean;
}) {
  return (
    <View accessible accessibilityRole={alert ? 'alert' : undefined} style={styles.notice}>
      <Text style={styles.noticeTitle}>
        {symbol} {title}
      </Text>
      <Text style={styles.body}>{text}</Text>
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
  label: { marginTop: 14, fontSize: 15, fontWeight: '700', color: colors.text },
  value: { marginTop: 4, fontSize: 16, lineHeight: 22, color: colors.textMuted },
  body: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  meta: { marginTop: 4, fontSize: 14, color: colors.textMuted },
  priority: { marginTop: 12, fontSize: 17, fontWeight: '700', color: colors.text },
  hazard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBackground,
  },
  hazardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  hazardBody: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.text },
  uncertain: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  uncertainTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  notice: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  noticeTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
});
