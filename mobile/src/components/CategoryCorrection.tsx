import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { ChoiceList } from '@/components/ChoiceList';
import { ApiError } from '@/lib/api';
import type { ReportCategory } from '@/report/tracking';
import { type CategoryOption, fetchCategories, setCategory } from '@/staff/reportActions';
import { colors } from '@/theme';

type Options = { status: 'loading' } | { status: 'ready'; options: CategoryOption[] } | { status: 'error' };

/**
 * Confirm or correct a report's category, for staff handling it (LS-19;
 * US-08, RC-03, RISK-01). The choice is saved as a staff decision; the AI's
 * suggestion is kept apart and never overwritten.
 */
export function CategoryCorrection({
  reportId,
  current,
  onSaved,
}: {
  reportId: string;
  current: ReportCategory | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <View style={styles.gap}>
        <Button
          accessibilityHint="Choose the category as a staff decision"
          label={current?.source === 'staff' ? 'Change category' : 'Confirm or change category'}
          onPress={() => setOpen(true)}
          variant="secondary"
        />
      </View>
    );
  }
  return (
    <CategoryPicker
      current={current}
      onCancel={() => setOpen(false)}
      onSaved={() => {
        setOpen(false);
        onSaved();
      }}
      reportId={reportId}
    />
  );
}

function CategoryPicker({
  reportId,
  current,
  onCancel,
  onSaved,
}: {
  reportId: string;
  current: ReportCategory | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [options, setOptions] = useState<Options>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchCategories()
      .then((list) => {
        if (!active) return;
        setOptions({ status: 'ready', options: list });
        // Start from the current category, so confirming it is one tap.
        const match = list.find((option) => option.name === current?.name);
        setSelected((value) => value ?? match?.id ?? null);
      })
      .catch(() => {
        if (active) setOptions({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt, current?.name]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await setCategory(reportId, selected);
      onSaved();
    } catch (failure) {
      setSaving(false);
      setError(
        failure instanceof ApiError && failure.detail
          ? failure.detail
          : 'The category could not be saved. Check your connection and try again.',
      );
    }
  }

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>Set the category (staff decision)</Text>
      <Text style={styles.body}>
        Your choice is saved as confirmed by staff. The AI suggestion stays on record separately.
      </Text>
      {options.status === 'loading' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.body}>Loading categories…</Text>
        </View>
      ) : null}
      {options.status === 'error' ? (
        <View>
          <Text accessibilityRole="alert" style={styles.errorText}>
            The categories could not be loaded.
          </Text>
          <View style={styles.gap}>
            <Button
              label="Try again"
              onPress={() => {
                setOptions({ status: 'loading' });
                setAttempt((count) => count + 1);
              }}
              variant="secondary"
            />
          </View>
        </View>
      ) : null}
      {options.status === 'ready' ? (
        <ChoiceList
          label="Category"
          onSelect={setSelected}
          options={options.options.map((option) => ({ value: option.id, label: option.name }))}
          selected={selected}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : null}
      <View style={styles.gap}>
        <Button
          busy={saving}
          disabled={!selected || saving}
          label={saving ? 'Saving…' : 'Save category'}
          onPress={save}
        />
      </View>
      <View style={styles.gap}>
        <Button disabled={saving} label="Cancel" onPress={onCancel} variant="secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 12 },
  row: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  heading: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  errorText: { marginTop: 8, fontSize: 15, lineHeight: 21, color: colors.error },
});
