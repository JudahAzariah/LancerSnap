import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { API_URL } from './src/config';

type BackendState = 'checking' | 'connected' | 'unreachable';

const BACKEND_LABEL: Record<BackendState, string> = {
  checking: 'Checking backend…',
  connected: 'Backend: connected',
  unreachable: 'Backend: not reachable',
};

export default function App() {
  const [backend, setBackend] = useState<BackendState>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((response) => {
        if (!cancelled) setBackend(response.ok ? 'connected' : 'unreachable');
      })
      .catch(() => {
        if (!cancelled) setBackend('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        LancerSnap
      </Text>
      <Text style={styles.subtitle}>Campus issue reporting for CBU</Text>
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {BACKEND_LABEL[backend]}
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 16,
    color: '#374151',
  },
  status: {
    marginTop: 24,
    fontSize: 14,
    color: '#374151',
  },
});
