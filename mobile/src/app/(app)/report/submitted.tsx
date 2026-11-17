import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmergencyNotice } from '@/components/EmergencyNotice';
import { colors } from '@/theme';

/**
 * Receipt after a successful submission (LS-09; US-01, RC-12). Reached only
 * after the server confirmed it stored the report.
 */
export default function ReportSubmittedScreen() {
  const { reference, location } = useLocalSearchParams<{ reference?: string; location?: string }>();

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      <View accessibilityLiveRegion="polite" style={styles.receipt}>
        <Text accessibilityRole="header" style={styles.heading}>
          Report received
        </Text>
        <Text style={styles.body}>Thank you. Your report has been received.</Text>

        <Text style={styles.label}>Report number</Text>
        <Text selectable style={styles.reference}>
          {reference ?? 'Not available'}
        </Text>

        {location ? (
          <>
            <Text style={styles.label}>Location</Text>
            <Text style={styles.body}>{location}</Text>
          </>
        ) : null}

        <Text style={styles.label}>Status</Text>
        <Text style={styles.body}>Submitted</Text>
      </View>

      <Text style={styles.body}>
        Keep the report number for your records. Campus staff will review the report.
      </Text>

      <View style={styles.actions}>
        <Button label="Done" onPress={() => router.dismissTo('/')} />
      </View>

      <EmergencyNotice />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  receipt: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text },
  label: { marginTop: 16, fontSize: 14, fontWeight: '700', color: colors.text },
  reference: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.text,
  },
  body: { marginTop: 8, fontSize: 16, lineHeight: 22, color: colors.textMuted },
  actions: { marginTop: 24, marginBottom: 24 },
});
