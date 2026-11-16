import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/Button';
import { IS_SUPABASE_CONFIGURED } from '@/config';
import { colors } from '@/theme';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    const message = await signIn(trimmedEmail, password);
    setSubmitting(false);
    if (message) {
      // Keep the email so the user can correct and retry.
      setError(message);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.title}>
            LancerSnap
          </Text>
          <Text style={styles.subtitle}>Sign in to report a campus issue.</Text>

          {!IS_SUPABASE_CONFIGURED ? (
            <View accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>
                Sign-in is not set up yet. Add the Supabase project URL and publishable key to
                mobile/.env, then restart the app.
              </Text>
            </View>
          ) : null}

          <Text nativeID="email-label" style={styles.label}>
            Email
          </Text>
          <TextInput
            accessibilityLabel="Email"
            accessibilityLabelledBy="email-label"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            inputMode="email"
            onChangeText={setEmail}
            style={styles.input}
            textContentType="username"
            value={email}
          />

          <Text nativeID="password-label" style={styles.label}>
            Password
          </Text>
          <TextInput
            accessibilityLabel="Password"
            accessibilityLabelledBy="password-label"
            autoCapitalize="none"
            autoComplete="current-password"
            onChangeText={setPassword}
            onSubmitEditing={handleSubmit}
            secureTextEntry
            style={styles.input}
            textContentType="password"
            value={password}
          />

          {error ? (
            <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
              <Text style={styles.errorText}>Could not sign in: {error}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              busy={submitting}
              disabled={!IS_SUPABASE_CONFIGURED}
              label={submitting ? 'Signing in…' : 'Sign in'}
              onPress={handleSubmit}
            />
          </View>

          <Text style={styles.help}>
            Use the account you were given for LancerSnap. Accounts are created by an administrator.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  title: { fontSize: 32, fontWeight: '700', color: colors.text },
  subtitle: { marginTop: 8, marginBottom: 24, fontSize: 16, color: colors.textMuted },
  label: { marginTop: 12, marginBottom: 6, fontSize: 16, fontWeight: '600', color: colors.text },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  actions: { marginTop: 24 },
  error: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorBackground,
  },
  errorText: { fontSize: 15, color: colors.error },
  notice: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeText: { fontSize: 15, color: colors.text },
  help: { marginTop: 24, fontSize: 14, color: colors.textMuted },
});
