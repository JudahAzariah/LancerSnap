import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shows a spinner and announces the busy state to assistive technology. */
  busy?: boolean;
  variant?: 'primary' | 'secondary';
};

export function Button({ label, onPress, disabled, busy, variant = 'primary' }: Props) {
  const inactive = Boolean(disabled || busy);
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        inactive && (primary ? styles.primaryInactive : styles.secondaryInactive),
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? colors.onPrimary : colors.primary} /> : null}
      <Text style={[styles.label, primary ? styles.primaryLabel : styles.secondaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  secondary: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.background },
  primaryInactive: { backgroundColor: colors.disabled },
  secondaryInactive: { borderColor: colors.disabled },
  pressed: { opacity: 0.8 },
  label: { fontSize: 16, fontWeight: '600' },
  primaryLabel: { color: colors.onPrimary },
  secondaryLabel: { color: colors.primary },
});
