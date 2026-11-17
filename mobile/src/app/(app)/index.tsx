import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { type Role, useProfile } from '@/auth/ProfileProvider';
import { Button } from '@/components/Button';
import { EmergencyNotice } from '@/components/EmergencyNotice';
import { colors } from '@/theme';

const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  staff: 'Campus staff',
  administrator: 'Administrator',
};

export default function HomeScreen() {
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSignOutError(null);
    setSigningOut(true);
    const message = await signOut();
    if (message) {
      setSignOutError(message);
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          LancerSnap
        </Text>
        <Text style={styles.body}>Signed in as {session?.user.email ?? 'your account'}.</Text>

        {profile.status === 'loading' ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>Loading your account…</Text>
          </View>
        ) : null}

        {profile.status === 'error' ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Text style={styles.errorText}>
              Could not load your account from the server. Check your connection and try again.
            </Text>
            <View style={styles.gap}>
              <Button label="Try again" onPress={profile.retry} variant="secondary" />
            </View>
          </View>
        ) : null}

        {profile.status === 'ready' ? (
          <>
            <Text style={styles.body}>Role: {ROLE_LABEL[profile.profile.role]}</Text>
            {profile.profile.role === 'student' ? (
              <View style={styles.section}>
                <Button
                  large
                  label="Snap & Report"
                  accessibilityHint="Report a campus issue by taking or choosing a photo"
                  onPress={() => router.push('/report/new')}
                />
                <Text style={styles.helper}>
                  Take a photo of a campus issue and tell us where it is. You do not need to know
                  who handles it.
                </Text>
                <View style={styles.gap}>
                  <Button
                    label="My reports"
                    accessibilityHint="See the reports you have submitted and their status"
                    onPress={() => router.push('/my-reports')}
                    variant="secondary"
                  />
                </View>
                <View style={styles.gap}>
                  <EmergencyNotice />
                </View>
              </View>
            ) : (
              <Text style={styles.section}>
                Staff and administrator tools are not available in the app yet.
              </Text>
            )}
          </>
        ) : null}

        {signOutError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            Could not sign out: {signOutError}
          </Text>
        ) : null}

        <View style={styles.signOut}>
          <Button
            busy={signingOut}
            label={signingOut ? 'Signing out…' : 'Sign out'}
            onPress={handleSignOut}
            variant="secondary"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  title: { fontSize: 32, fontWeight: '700', color: colors.text },
  body: { marginTop: 12, fontSize: 16, color: colors.textMuted },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  section: { marginTop: 28, fontSize: 16, color: colors.textMuted },
  helper: { marginTop: 10, fontSize: 15, lineHeight: 21, color: colors.textMuted },
  gap: { marginTop: 16 },
  errorBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { marginTop: 4, fontSize: 15, color: colors.error },
  signOut: { marginTop: 40 },
});
