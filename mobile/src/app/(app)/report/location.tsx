import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import {
  type CampusLocation,
  fetchLocations,
  filterLocations,
  locationTypeLabel,
} from '@/report/locations';
import { useReportDraft } from '@/report/ReportDraftProvider';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; locations: CampusLocation[] }
  | { status: 'error' };

/**
 * Snap & Report, step 2 (LS-07; US-06): choose where the issue is from the
 * supported campus locations. Device location is never requested.
 */
export default function LocationStepScreen() {
  const { location: selected, setLocation } = useReportDraft();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [showRequired, setShowRequired] = useState(false);

  useEffect(() => {
    let active = true;
    fetchLocations()
      .then((locations) => {
        if (active) setState({ status: 'ready', locations });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  const locations = state.status === 'ready' ? state.locations : null;
  const matches = useMemo(() => (locations ? filterLocations(locations, query) : []), [locations, query]);

  // A location chosen earlier that the server no longer offers cannot be used.
  const selectedIsOffered =
    selected !== null && locations !== null && locations.some((item) => item.id === selected.id);
  const stale = selected !== null && locations !== null && !selectedIsOffered;

  function choose(location: CampusLocation) {
    setLocation(location);
    setShowRequired(false);
  }

  function handleContinue() {
    if (!selectedIsOffered) {
      setShowRequired(true);
      return;
    }
    router.push('/report/review');
  }

  const header = (
    <View>
      <Text accessibilityRole="header" style={styles.heading}>
        Where is the issue?
      </Text>
      <Text style={styles.helper}>
        Choose the campus location. LancerSnap does not use your device&apos;s location.
      </Text>

      {state.status === 'ready' ? (
        <>
          <Text nativeID="location-search-label" style={styles.label}>
            Search locations
          </Text>
          <TextInput
            accessibilityLabel="Search locations"
            accessibilityLabelledBy="location-search-label"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            style={styles.search}
            value={query}
          />
          <Text accessibilityLiveRegion="polite" style={styles.count}>
            {matches.length === 1 ? '1 location' : `${matches.length} locations`}
            {query.trim() ? ` matching "${query.trim()}"` : ''}
          </Text>
        </>
      ) : null}

      {state.status === 'loading' ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.helper}>Loading locations…</Text>
        </View>
      ) : null}

      {state.status === 'error' ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>
            Locations could not be loaded. Check your connection and try again. Your photo and note
            are kept.
          </Text>
          <View style={styles.gap}>
            <Button label="Try again" onPress={retry} variant="secondary" />
          </View>
        </View>
      ) : null}

      {state.status === 'ready' && state.locations.length === 0 ? (
        <Text style={styles.helper}>
          No campus locations are available right now, so a report cannot be submitted.
        </Text>
      ) : null}

      {state.status === 'ready' && state.locations.length > 0 && matches.length === 0 ? (
        <Text style={styles.helper}>
          No locations match your search. Try a different name, or clear the search to see all
          locations.
        </Text>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {stale ? (
        <View accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>
            {selected?.name} is no longer available. Choose another location.
          </Text>
        </View>
      ) : null}
      {showRequired && !stale ? (
        <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
          <Text style={styles.errorText}>Choose a location to continue.</Text>
        </View>
      ) : null}
      {selectedIsOffered ? (
        <Text accessibilityLiveRegion="polite" style={styles.selectedSummary}>
          Selected: {selected?.name}
        </Text>
      ) : null}
      <View style={styles.gap}>
        <Button
          disabled={state.status !== 'ready'}
          label="Continue"
          accessibilityHint="Next, review your report"
          onPress={handleContinue}
        />
      </View>
    </View>
  );

  return (
    <FlatList
      accessibilityRole="radiogroup"
      contentContainerStyle={styles.content}
      data={matches}
      extraData={selected?.id}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      ListFooterComponent={footer}
      ListHeaderComponent={header}
      renderItem={({ item }) => {
        const isSelected = selected?.id === item.id;
        return (
          <Pressable
            accessibilityLabel={`${item.name}, ${locationTypeLabel(item.location_type)}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            onPress={() => choose(item)}
            style={({ pressed }) => [
              styles.option,
              isSelected && styles.optionSelected,
              pressed && styles.optionPressed,
            ]}
          >
            {/* Selection is shown by a mark and the word "Selected", not colour alone. */}
            <View style={[styles.radio, isSelected && styles.radioSelected]}>
              {isSelected ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionName}>{item.name}</Text>
              <Text style={styles.optionType}>
                {locationTypeLabel(item.location_type)}
                {isSelected ? ' · Selected' : ''}
              </Text>
            </View>
          </Pressable>
        );
      }}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
  heading: { fontSize: 20, fontWeight: '700', color: colors.text },
  helper: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  label: { marginTop: 20, marginBottom: 6, fontSize: 16, fontWeight: '600', color: colors.text },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  count: { marginTop: 6, marginBottom: 8, fontSize: 13, color: colors.textMuted },
  statusRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  option: {
    minHeight: 56,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.background,
  },
  optionSelected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surface },
  optionPressed: { opacity: 0.8 },
  optionText: { flex: 1 },
  optionName: { fontSize: 16, fontWeight: '600', color: colors.text },
  optionType: { marginTop: 2, fontSize: 14, color: colors.textMuted },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  footer: { marginTop: 20, marginBottom: 24 },
  selectedSummary: { fontSize: 16, fontWeight: '600', color: colors.text },
  gap: { marginTop: 12 },
  error: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { fontSize: 15, lineHeight: 21, color: colors.error },
});
