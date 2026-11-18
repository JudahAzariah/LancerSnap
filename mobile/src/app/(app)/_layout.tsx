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
          <Stack.Screen name="report/review" options={{ title: 'Review' }} />
          <Stack.Screen name="my-reports" options={{ title: 'My reports' }} />
          <Stack.Screen name="reports/[id]" options={{ title: 'Report details' }} />
          <Stack.Screen name="admin/routing" options={{ title: 'Routing settings' }} />
          <Stack.Screen name="review" options={{ title: 'Manual review' }} />
          <Stack.Screen name="staff" options={{ title: 'Staff queue' }} />
          <Stack.Screen
            name="report/submitted"
            // The report is sent; going back into the finished draft makes no sense.
            options={{ title: 'Report received', headerBackVisible: false, gestureEnabled: false }}
          />
        </Stack>
      </ReportDraftProvider>
    </ProfileProvider>
  );
}
