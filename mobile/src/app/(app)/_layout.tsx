import { Stack } from 'expo-router';

import { ProfileProvider } from '@/auth/ProfileProvider';
import { ReportDraftProvider } from '@/report/ReportDraftProvider';

export default function AppLayout() {
  return (
    <ProfileProvider>
      <ReportDraftProvider>
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="report/new" options={{ title: 'Snap & Report' }} />
          <Stack.Screen name="report/location" options={{ title: 'Location' }} />
        </Stack>
      </ReportDraftProvider>
    </ProfileProvider>
  );
}
