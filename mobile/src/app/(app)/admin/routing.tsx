import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createRule,
  createTeam,
  fetchRoutingConfig,
  isUnverifiedExample,
  type RoutingConfig,
  type RoutingRule,
  type Team,
  updateRule,
  updateTeam,
} from '@/admin/routing';
import { useProfile } from '@/auth/ProfileProvider';
import { Button } from '@/components/Button';
import { ChoiceList } from '@/components/ChoiceList';
import { ApiError } from '@/lib/api';
import { colors } from '@/theme';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; config: RoutingConfig }
  | { status: 'error' };

const ALL_LOCATIONS = 'all';

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.detail) return error.detail;
  return 'The change could not be saved. Check your connection and try again.';
}

/**
 * Routing configuration (LS-16; US-11, RC-04, RC-05). Administrators only;
 * the backend enforces this too. Rules send a category, optionally at one
 * location, to a team. Changes apply to new reports with no app change.
 */
export default function RoutingScreen() {
  const profile = useProfile();
  const isAdmin = profile.status === 'ready' && profile.profile.role === 'administrator';
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<{ kind: 'error' | 'done'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetchRoutingConfig()
      .then((config) => {
        if (active) setState({ status: 'ready', config });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [isAdmin, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ kind: 'done', text: done });
      reload();
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  if (profile.status === 'ready' && !isAdmin) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.body}>
          Only administrators can change routing.
        </Text>
      </View>
    );
  }
  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.body}>Loading routing settings…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          Routing settings could not be loaded.
        </Text>
        <View style={styles.gap}>
          <Button
            label="Try again"
            onPress={() => {
              setState({ status: 'loading' });
              reload();
            }}
            variant="secondary"
          />
        </View>
      </View>
    );
  }

  const { config } = state;
  const activeTeams = config.teams.filter((team) => team.is_active);
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>⚠ Example configuration, not confirmed</Text>
        <Text style={styles.body}>
          Teams and rules marked “(example, unverified)” come from the design document. They are
          not confirmed CBU ownership and must be checked with CBU before real use.
        </Text>
      </View>

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={message.kind === 'error' ? 'alert' : undefined}
          style={message.kind === 'error' ? styles.errorText : styles.doneText}
        >
          {message.kind === 'error' ? '✕ ' : '✓ '}
          {message.text}
        </Text>
      ) : null}

      <Text accessibilityRole="header" style={styles.heading}>
        Routing rules
      </Text>
      <Text style={styles.body}>
        New reports go to the team of the rule that matches their category. A rule for one location
        wins over a rule for all locations. Reports with no matching rule go to manual review.
      </Text>
      {config.rules.length === 0 ? <Text style={styles.body}>No rules yet.</Text> : null}
      {config.rules.map((rule) => (
        <RuleCard
          key={rule.id}
          busy={busy}
          onChangeTeam={(teamId) =>
            run(() => updateRule(rule.id, { team_id: teamId }), 'Rule updated.')
          }
          onToggle={() =>
            run(
              () => updateRule(rule.id, { is_active: !rule.is_active }),
              rule.is_active ? 'Rule turned off.' : 'Rule turned on.',
            )
          }
          rule={rule}
          teams={activeTeams}
        />
      ))}

      <NewRule
        busy={busy}
        config={config}
        onSave={(rule) => run(() => createRule(rule), 'Rule saved.')}
        teams={activeTeams}
      />

      <Text accessibilityRole="header" style={styles.heading}>
        Teams
      </Text>
      <Text style={styles.body}>Reports are routed to teams, never to individual people.</Text>
      {config.teams.map((team) => (
        <TeamRow
          key={team.id}
          busy={busy}
          onMakeReviewTeam={() =>
            run(
              () => updateTeam(team.id, { is_manual_review: true }),
              `${team.name} now receives reports for manual review.`,
            )
          }
          onToggle={() =>
            run(
              () => updateTeam(team.id, { is_active: !team.is_active }),
              team.is_active ? 'Team turned off.' : 'Team turned on.',
            )
          }
          team={team}
        />
      ))}
      <NewTeam busy={busy} onSave={(name) => run(() => createTeam(name), 'Team added.')} />
    </ScrollView>
  );
}

function RuleCard({
  rule,
  teams,
  busy,
  onChangeTeam,
  onToggle,
}: {
  rule: RoutingRule;
  teams: Team[];
  busy: boolean;
  onChangeTeam: (teamId: string) => void;
  onToggle: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <View
      accessibilityLabel={`Rule: ${rule.category.name} to ${rule.team.name}`}
      style={[styles.card, !rule.is_active && styles.cardOff]}
    >
      <Text style={styles.cardTitle}>{rule.category.name}</Text>
      <Text style={styles.value}>→ Team: {rule.team.name}</Text>
      <Text style={styles.value}>Where: {rule.location?.name ?? 'All locations'}</Text>
      <Text style={styles.value}>{rule.is_active ? '● On' : '○ Off'}</Text>
      {choosing ? (
        <ChoiceList
          label="Send to team"
          onSelect={(teamId) => {
            setChoosing(false);
            if (teamId !== rule.team.id) onChangeTeam(teamId);
          }}
          options={teams.map((team) => ({ value: team.id, label: team.name }))}
          selected={rule.team.id}
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          disabled={busy}
          label={choosing ? 'Cancel' : 'Change team'}
          onPress={() => setChoosing((open) => !open)}
          variant="secondary"
        />
        <Button
          disabled={busy}
          label={rule.is_active ? 'Turn off' : 'Turn on'}
          onPress={onToggle}
          variant="secondary"
        />
      </View>
    </View>
  );
}

function NewRule({
  config,
  teams,
  busy,
  onSave,
}: {
  config: RoutingConfig;
  teams: Team[];
  busy: boolean;
  onSave: (rule: { category_id: string; location_id: string | null; team_id: string }) => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [location, setLocation] = useState<string>(ALL_LOCATIONS);
  const [team, setTeam] = useState<string | null>(null);
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        Add a rule
      </Text>
      <ChoiceList
        label="Category"
        onSelect={setCategory}
        options={config.categories.map((c) => ({ value: c.id, label: c.name }))}
        selected={category}
      />
      <ChoiceList
        label="Location"
        onSelect={setLocation}
        options={[
          { value: ALL_LOCATIONS, label: 'All locations' },
          ...config.locations.map((l) => ({ value: l.id, label: l.name })),
        ]}
        selected={location}
      />
      <ChoiceList
        label="Team"
        onSelect={setTeam}
        options={teams.map((t) => ({ value: t.id, label: t.name }))}
        selected={team}
      />
      <View style={styles.gap}>
        <Button
          disabled={busy || !category || !team}
          label="Save rule"
          onPress={() => {
            if (!category || !team) return;
            onSave({
              category_id: category,
              location_id: location === ALL_LOCATIONS ? null : location,
              team_id: team,
            });
          }}
        />
      </View>
    </View>
  );
}

function TeamRow({
  team,
  busy,
  onToggle,
  onMakeReviewTeam,
}: {
  team: Team;
  busy: boolean;
  onToggle: () => void;
  onMakeReviewTeam: () => void;
}) {
  const members = `${team.member_count} member${team.member_count === 1 ? '' : 's'}`;
  return (
    <View style={[styles.card, !team.is_active && styles.cardOff]}>
      <Text style={styles.cardTitle}>{team.name}</Text>
      <Text style={styles.value}>
        {team.is_active ? '● On' : '○ Off'} · {members}
        {isUnverifiedExample(team.name) ? ' · example, not confirmed' : ''}
      </Text>
      {team.is_manual_review ? (
        <Text style={styles.reviewMark}>★ Manual-review team: receives reports the AI could not route</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          disabled={busy}
          label={team.is_active ? 'Turn off' : 'Turn on'}
          onPress={onToggle}
          variant="secondary"
        />
        {!team.is_manual_review && team.is_active ? (
          <Button
            disabled={busy}
            label="Use for manual review"
            onPress={onMakeReviewTeam}
            variant="secondary"
          />
        ) : null}
      </View>
    </View>
  );
}

function NewTeam({ busy, onSave }: { busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Add a team</Text>
      <TextInput
        accessibilityLabel="New team name"
        maxLength={120}
        onChangeText={setName}
        placeholder="Team name"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={name}
      />
      <View style={styles.gap}>
        <Button
          disabled={busy || name.trim() === ''}
          label="Add team"
          onPress={() => {
            onSave(name.trim());
            setName('');
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, width: '100%', maxWidth: 640, alignSelf: 'center' },
  centered: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  heading: { marginTop: 28, fontSize: 20, fontWeight: '700', color: colors.text },
  body: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  value: { marginTop: 4, fontSize: 15, color: colors.textMuted },
  gap: { marginTop: 14 },
  warning: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningBackground,
  },
  warningTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  errorText: { marginTop: 14, fontSize: 15, lineHeight: 21, color: colors.error },
  doneText: { marginTop: 14, fontSize: 15, color: colors.text },
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardOff: { borderStyle: 'dashed' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  reviewMark: { marginTop: 4, fontSize: 15, fontWeight: '700', color: colors.text },
  actions: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontSize: 16,
    color: colors.text,
  },
});
