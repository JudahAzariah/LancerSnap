import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

/**
 * Emergency boundary (RC-08, DD-09): LancerSnap is a reporting tool and does
 * not dispatch help. Shown wherever a student starts or continues a report.
 */
export function EmergencyNotice() {
  return (
    <View accessibilityRole="alert" style={styles.box}>
      <Text style={styles.heading}>Not for emergencies</Text>
      <Text style={styles.body}>
        LancerSnap does not contact emergency services. If someone is in danger or needs help right
        away, call 911 or contact campus safety directly.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBackground,
  },
  heading: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { marginTop: 4, fontSize: 15, lineHeight: 21, color: colors.text },
});
