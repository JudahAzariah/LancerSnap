import { router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { EmergencyNotice } from '@/components/EmergencyNotice';
import { MAX_NOTE_LENGTH } from '@/report/photo';
import { choosePhoto, type PickResult, takePhoto } from '@/report/pickPhoto';
import { useReportDraft } from '@/report/ReportDraftProvider';
import { colors } from '@/theme';

type Source = 'camera' | 'library';

/**
 * Snap & Report, step 1 (LS-06; US-01, DD-01, DD-02): a photo and an optional
 * note. The student is not asked who should handle the issue.
 */
export default function SnapAndReportScreen() {
  const { photo, note, setPhoto, setNote } = useReportDraft();
  const [opening, setOpening] = useState<Source | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(source: Source) {
    setProblem(null);
    setOpening(source);
    const result: PickResult = await (source === 'camera' ? takePhoto() : choosePhoto());
    setOpening(null);
    if (result.status === 'picked') {
      setPhoto(result.photo);
    } else if (result.status === 'denied' || result.status === 'rejected') {
      // Any photo already chosen is kept so nothing the student did is lost.
      setProblem(result.message);
    }
  }

  const busy = opening !== null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <EmergencyNotice />

        <Text accessibilityRole="header" style={styles.heading}>
          Photo
        </Text>

        {photo ? (
          <>
            <Image
              accessibilityLabel="Preview of the photo for your report"
              accessible
              resizeMode="contain"
              source={{ uri: photo.uri }}
              style={styles.preview}
            />
            <Text style={styles.helper}>Photo added. Check that it shows the issue clearly.</Text>
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Button
                  busy={opening === 'camera'}
                  disabled={busy}
                  label="Retake photo"
                  onPress={() => pick('camera')}
                  variant="secondary"
                />
              </View>
              <View style={styles.rowItem}>
                <Button
                  busy={opening === 'library'}
                  disabled={busy}
                  label="Choose a different photo"
                  onPress={() => pick('library')}
                  variant="secondary"
                />
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.helper}>
              Take a photo of the issue, or choose one you already have.
            </Text>
            <View style={styles.stack}>
              <Button
                large
                busy={opening === 'camera'}
                disabled={busy}
                label="Take photo"
                accessibilityHint="Opens the camera"
                onPress={() => pick('camera')}
              />
              <Button
                busy={opening === 'library'}
                disabled={busy}
                label="Choose from library"
                accessibilityHint="Opens your photo library"
                onPress={() => pick('library')}
                variant="secondary"
              />
            </View>
          </>
        )}

        {problem ? (
          <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
            <Text style={styles.errorText}>Photo not added: {problem}</Text>
          </View>
        ) : null}

        <Text nativeID="note-label" style={styles.heading}>
          Note (optional)
        </Text>
        <Text style={styles.helper}>
          Add anything that helps staff understand the issue. You can leave this blank.
        </Text>
        <TextInput
          accessibilityLabel="Note (optional)"
          accessibilityLabelledBy="note-label"
          maxLength={MAX_NOTE_LENGTH}
          multiline
          onChangeText={setNote}
          style={styles.note}
          textAlignVertical="top"
          value={note}
        />
        <Text style={styles.counter}>
          {note.length} of {MAX_NOTE_LENGTH} characters
        </Text>

        <View style={styles.actions}>
          <Button
            disabled={!photo || busy}
            label="Continue"
            accessibilityHint="Next, choose where the issue is"
            onPress={() => router.push('/report/location')}
          />
          {!photo ? <Text style={styles.helper}>Add a photo to continue.</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  heading: { marginTop: 24, fontSize: 20, fontWeight: '700', color: colors.text },
  helper: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  stack: { marginTop: 12, gap: 12 },
  row: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  rowItem: { flexGrow: 1, flexBasis: 200 },
  preview: {
    marginTop: 12,
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  error: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { fontSize: 15, lineHeight: 21, color: colors.error },
  note: {
    marginTop: 10,
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  counter: { marginTop: 4, fontSize: 13, color: colors.textMuted, textAlign: 'right' },
  actions: { marginTop: 28, marginBottom: 24 },
});
