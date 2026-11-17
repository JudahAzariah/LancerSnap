import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/theme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shows a spinner and announces the busy state to assistive technology. */
  busy?: boolean;
  variant?: 'primary' | 'secondary';
  /** Taller, with larger text: for a screen's main action. */
  large?: boolean;
  /** Extra context read by screen readers after the label. */
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  disabled,
  busy,
  variant = 'primary',
  large,
  accessibilityHint,
}: Props) {
  const inactive = Boolean(disabled || busy);
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        large && styles.large,
        primary ? styles.primary : styles.secondary,
        inactive && (primary ? styles.primaryInactive : styles.secondaryInactive),
        pressed && styles.pressed,
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? colors.onPrimary : colors.primary} /> : null}
      <Text
        style={[
          styles.label,
          large && styles.largeLabel,
          primary ? styles.primaryLabel : styles.secondaryLabel,
        ]}
      >
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
  large: { minHeight: 64, borderRadius: 12 },
  largeLabel: { fontSize: 20 },
  primary: { backgroundColor: colors.primary },
  secondary: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.background },
  primaryInactive: { backgroundColor: colors.disabled },
  secondaryInactive: { borderColor: colors.disabled },
  pressed: { opacity: 0.8 },
  label: { fontSize: 16, fontWeight: '600' },
  primaryLabel: { color: colors.onPrimary },
  secondaryLabel: { color: colors.primary },
});
