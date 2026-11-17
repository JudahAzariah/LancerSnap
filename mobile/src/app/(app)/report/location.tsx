import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { colors } from '@/theme';

/**
 * Snap & Report, step 2. Campus location selection is implemented in LS-07;
 * until then this screen says so plainly instead of pretending to work.
 */
export default function LocationStepScreen() {
  return (
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>
        Choose a location
      </Text>
      <Text style={styles.body}>
        Choosing the campus location is the next step of a report. It is not available in the app
        yet, so reports cannot be submitted yet.
      </Text>
      <Text style={styles.body}>Your photo and note are kept while you stay signed in.</Text>
      <View style={styles.actions}>
        <Button label="Back to photo" onPress={() => router.back()} variant="secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    padding: 24,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: colors.background,
  },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text },
  body: { marginTop: 10, fontSize: 16, lineHeight: 22, color: colors.textMuted },
  actions: { marginTop: 24 },
});
