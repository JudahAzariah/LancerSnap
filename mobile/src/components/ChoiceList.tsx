import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

type Option = { value: string; label: string };

/**
 * Pick one option. The selected option is marked with "●" and announced as
 * selected, not shown by color alone (RC-11).
 */
export function ChoiceList({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Option[];
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup" style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.options}>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <Pressable
              key={option.value}
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              onPress={() => onSelect(option.value)}
              style={[styles.option, isSelected && styles.selected]}
            >
              <Text style={[styles.optionText, isSelected && styles.selectedText]}>
                {isSelected ? '● ' : '○ '}
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: 12 },
  label: { fontSize: 15, fontWeight: '700', color: colors.text },
  options: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  selected: { borderWidth: 2, borderColor: colors.primary },
  optionText: { fontSize: 15, color: colors.text },
  selectedText: { fontWeight: '700' },
});
