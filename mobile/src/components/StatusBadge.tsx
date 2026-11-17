import { StyleSheet, Text, View } from 'react-native';

import { statusLabel } from '@/report/status';
import { colors } from '@/theme';

/** A report's status as a labelled badge. The text carries the meaning. */
export function StatusBadge({ status }: { status: string }) {
  const label = statusLabel(status);
  return (
    <View accessibilityLabel={`Status: ${label}`} accessible style={styles.badge}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  text: { fontSize: 14, fontWeight: '700', color: colors.text },
});
