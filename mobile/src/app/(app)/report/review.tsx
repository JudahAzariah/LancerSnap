import { router } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmergencyNotice } from '@/components/EmergencyNotice';
import { locationTypeLabel } from '@/report/locations';
import { useReportDraft } from '@/report/ReportDraftProvider';
import { colors } from '@/theme';

/**
 * Snap & Report, step 3: review before submitting. Sending the report is
 * implemented with the submission API (LS-09); until then this screen says so
 * plainly instead of showing a submit button that would not work.
 */
export default function ReviewStepScreen() {
  const { photo, note, location } = useReportDraft();
  const complete = photo !== null && location !== null;

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

      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          Submitting reports is not available in the app yet. Nothing has been sent.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button label="Back" onPress={() => router.back()} variant="secondary" />
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
  notice: {
    marginTop: 24,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeText: { fontSize: 15, lineHeight: 21, color: colors.text },
  error: {
    marginTop: 20,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { fontSize: 15, lineHeight: 21, color: colors.error },
  actions: { marginTop: 20, marginBottom: 24 },
});
