import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ReportSubmittedScreen from '@/app/(app)/report/submitted';

jest.mock('expo-router', () => ({
  router: { dismissTo: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

describe('Report received', () => {
  it('shows the report number, location, and status', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({
      reference: 'RPT-000042',
      location: 'Yeager Center',
    });
    await render(<ReportSubmittedScreen />);
    expect(screen.getByText('Report received')).toBeOnTheScreen();
    expect(screen.getByText('RPT-000042')).toBeOnTheScreen();
    expect(screen.getByText('Yeager Center')).toBeOnTheScreen();
    expect(screen.getByText('Submitted')).toBeOnTheScreen();
    expect(screen.getByText('Not for emergencies')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(router.dismissTo).toHaveBeenCalledWith('/');
  });
});
