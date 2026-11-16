import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/Button';
import { apiFetch } from '@/lib/api';
import { colors } from '@/theme';

type Role = 'student' | 'staff' | 'administrator';
type Me = { id: string; email: string | null; role: Role; team_ids: string[] };
type BackendCheck = 'checking' | 'verified' | 'failed';

const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  staff: 'Campus staff',
  administrator: 'Administrator',
};

const BACKEND_LABEL: Record<BackendCheck, string> = {
  checking: 'Checking your session with the server…',
  verified: 'Server check: your session is verified.',
  failed: 'Server check failed: the server could not verify your session.',
};

/** Placeholder home screen. The Snap & Report flow is added in Phase 2. */
export default function HomeScreen() {
  const { session, signOut } = useAuth();
  const [backend, setBackend] = useState<BackendCheck>('checking');
  const [role, setRole] = useState<Role | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<Me>('/me')
      .then((me) => {
        if (!active) return;
        setRole(me.role);
        setBackend('verified');
      })
      .catch(() => {
        if (active) setBackend('failed');
      });
    return () => {
      active = false;
    };
  }, []);

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
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          LancerSnap
        </Text>
        <Text style={styles.body}>Signed in as {session?.user.email ?? 'your account'}.</Text>
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {BACKEND_LABEL[backend]}
        </Text>
        {role ? <Text style={styles.body}>Role: {ROLE_LABEL[role]}</Text> : null}

        {signOutError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            Could not sign out: {signOutError}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            busy={signingOut}
            label={signingOut ? 'Signing out…' : 'Sign out'}
            onPress={handleSignOut}
            variant="secondary"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  title: { fontSize: 32, fontWeight: '700', color: colors.text },
  body: { marginTop: 12, fontSize: 16, color: colors.textMuted },
  error: { marginTop: 16, fontSize: 15, color: colors.error },
  actions: { marginTop: 32 },
});
