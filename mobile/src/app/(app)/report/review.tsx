import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmergencyNotice } from '@/components/EmergencyNotice';
import { locationTypeLabel } from '@/report/locations';
import { useReportDraft } from '@/report/ReportDraftProvider';
import { SubmitError, type SubmitStage, submitReport } from '@/report/submit';
import { colors } from '@/theme';

const STAGE_LABEL: Record<SubmitStage, string> = {
  uploading: 'Uploading your photo…',
  submitting: 'Submitting your report…',
};

/** Snap & Report, step 3 (LS-09; US-01): review, then submit. */
export default function ReviewStepScreen() {
  const draft = useReportDraft();
  const { photo, note, location } = draft;
  const [stage, setStage] = useState<SubmitStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const complete = photo !== null && location !== null;
  const submitting = stage !== null;

  async function handleSubmit() {
    if (!photo || !location || submitting) return;
    setError(null);
    try {
      const receipt = await submitReport(
        { photo, location, note, uploadedMediaId: draft.uploadedMediaId },
        { onStage: setStage, onUploaded: draft.setUploadedMediaId },
      );
      draft.reset();
      router.replace({
        pathname: '/report/submitted',
        params: { reference: receipt.reference_code, location: receipt.location.name },
      });
    } catch (caught) {
      if (caught instanceof SubmitError) {
        if (caught.discardUpload) draft.setUploadedMediaId(null);
        setError(caught.message);
      } else {
        setError('Your report was not submitted. Try again.');
      }
      setStage(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      <Text accessibilityRole="header" style={styles.heading}>
        Review your report
      </Text>

      <Text style={styles.label}>Photo</Text>
      {photo ? (
        <Image
          accessibilityLabel="The photo for your report"
          accessible
          resizeMode="contain"
          source={{ uri: photo.uri }}
          style={styles.preview}
        />
      ) : (
        <Text style={styles.missing}>No photo added.</Text>
      )}

      <Text style={styles.label}>Location</Text>
      {location ? (
        <Text style={styles.value}>
          {location.name} ({locationTypeLabel(location.location_type)})
        </Text>
      ) : (
        <Text style={styles.missing}>No location chosen.</Text>
      )}

      <Text style={styles.label}>Note (optional)</Text>
      <Text style={styles.value}>{note.trim() ? note.trim() : 'No note added.'}</Text>

      {!complete ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>
            A report needs a photo and a location. Go back to add what is missing.
          </Text>
        </View>
      ) : null}

      {error ? (
        <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {stage ? (
        <View accessibilityLiveRegion="polite" style={styles.progress}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.value}>{STAGE_LABEL[stage]}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          busy={submitting}
          disabled={!complete}
          label={submitting ? 'Submitting…' : error ? 'Try again' : 'Submit report'}
          accessibilityHint="Sends your report to campus staff"
          onPress={handleSubmit}
        />
        <Button
          disabled={submitting}
          label="Back"
          onPress={() => router.back()}
          variant="secondary"
        />
      </View>

      <EmergencyNotice />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text },
  label: { marginTop: 20, fontSize: 16, fontWeight: '700', color: colors.text },
  value: { marginTop: 6, fontSize: 16, lineHeight: 22, color: colors.textMuted },
  missing: { marginTop: 6, fontSize: 16, color: colors.error },
  preview: {
    marginTop: 8,
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  progress: { marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  error: {
    marginTop: 20,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { fontSize: 15, lineHeight: 21, color: colors.error },
  actions: { marginTop: 24, marginBottom: 24, gap: 12 },
});
