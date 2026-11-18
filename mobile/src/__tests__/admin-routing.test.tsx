import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  createRule,
  createTeam,
  fetchRoutingConfig,
  type RoutingConfig,
  updateRule,
  updateTeam,
} from '@/admin/routing';
import RoutingScreen from '@/app/(app)/admin/routing';
import { type Role, useProfile } from '@/auth/ProfileProvider';
import { ApiError } from '@/lib/api';

jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/auth/ProfileProvider', () => ({ useProfile: jest.fn() }));
jest.mock('@/admin/routing', () => ({
  ...jest.requireActual('@/admin/routing'),
  fetchRoutingConfig: jest.fn(),
  createRule: jest.fn(),
  updateRule: jest.fn(),
  createTeam: jest.fn(),
  updateTeam: jest.fn(),
}));

const FACILITIES = { id: 't-fac', name: 'Facilities (example, unverified)' };
const IT = { id: 't-it', name: 'IT / Technology Support (example, unverified)' };

const CONFIG: RoutingConfig = {
  rules: [
    {
      id: 'r-1',
      category: { id: 'c-fac', name: 'Facilities / maintenance issue' },
      location: null,
      team: FACILITIES,
      is_active: true,
      updated_at: '2026-11-18T20:00:00Z',
    },
  ],
  teams: [
    { ...FACILITIES, description: null, is_active: true, member_count: 0 },
    { ...IT, description: null, is_active: true, member_count: 1 },
  ],
  categories: [
    { id: 'c-fac', name: 'Facilities / maintenance issue', description: null },
    { id: 'c-it', name: 'IT / technology problem', description: null },
  ],
  locations: [{ id: 'l-eng', name: 'Engineering Building', location_type: 'building' }],
};

function signedInAs(role: Role) {
  jest.mocked(useProfile).mockReturnValue({
    status: 'ready',
    profile: { id: 'u-1', email: null, role, team_ids: [] },
    retry: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  signedInAs('administrator');
  jest.mocked(fetchRoutingConfig).mockResolvedValue(CONFIG);
});

describe('Routing settings', () => {
  it('lists rules with their team and locations, and warns the examples are unverified', async () => {
    await render(<RoutingScreen />);
    expect(await screen.findByText('⚠ Example configuration, not confirmed')).toBeOnTheScreen();
    expect(screen.getByLabelText(`Rule: Facilities / maintenance issue to ${FACILITIES.name}`)).toBeOnTheScreen();
    expect(screen.getByText('Where: All locations')).toBeOnTheScreen();
    expect(screen.getAllByText(/example, not confirmed/)).toHaveLength(2);
    expect(screen.getByText(/● On · 1 member · example/)).toBeOnTheScreen();
  });

  it('saves a new rule for a category, location, and team', async () => {
    jest.mocked(createRule).mockResolvedValue(CONFIG.rules[0]);
    await render(<RoutingScreen />);
    await screen.findByText('Add a rule');

    const save = screen.getByRole('button', { name: 'Save rule' });
    expect(save).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'IT / technology problem' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Engineering Building' }));
    const teamChoices = screen.getAllByRole('radio', { name: IT.name });
    await fireEvent.press(teamChoices[teamChoices.length - 1]);
    await fireEvent.press(save);

    expect(createRule).toHaveBeenCalledWith({
      category_id: 'c-it',
      location_id: 'l-eng',
      team_id: 't-it',
    });
    expect(await screen.findByText('✓ Rule saved.')).toBeOnTheScreen();
    expect(fetchRoutingConfig).toHaveBeenCalledTimes(2); // Reloaded after saving.
  });

  it('changes a rule’s team and turns it off', async () => {
    jest.mocked(updateRule).mockResolvedValue(CONFIG.rules[0]);
    await render(<RoutingScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Change team' }));
    await fireEvent.press(screen.getAllByRole('radio', { name: IT.name })[0]);
    expect(updateRule).toHaveBeenCalledWith('r-1', { team_id: 't-it' });

    await fireEvent.press(screen.getAllByRole('button', { name: 'Turn off' })[0]);
    expect(updateRule).toHaveBeenCalledWith('r-1', { is_active: false });
  });

  it('shows the server’s reason when a change is refused', async () => {
    jest
      .mocked(createRule)
      .mockRejectedValue(new ApiError(409, 'An active rule already exists for this category.'));
    await render(<RoutingScreen />);
    await screen.findByText('Add a rule');
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Facilities / maintenance issue' })[0]);
    const teamChoices = screen.getAllByRole('radio', { name: FACILITIES.name });
    await fireEvent.press(teamChoices[teamChoices.length - 1]);
    await fireEvent.press(screen.getByRole('button', { name: 'Save rule' }));
    expect(
      await screen.findByText('✕ An active rule already exists for this category.'),
    ).toBeOnTheScreen();
  });

  it('adds and turns off teams', async () => {
    jest.mocked(createTeam).mockResolvedValue({ ...CONFIG.teams[0] });
    jest.mocked(updateTeam).mockResolvedValue({ ...CONFIG.teams[0] });
    await render(<RoutingScreen />);
    await screen.findByText('Add a team');
    await fireEvent.changeText(screen.getByLabelText('New team name'), '  Grounds  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Add team' }));
    expect(createTeam).toHaveBeenCalledWith('Grounds');

    const offButtons = screen.getAllByRole('button', { name: 'Turn off' });
    await fireEvent.press(offButtons[offButtons.length - 1]);
    expect(updateTeam).toHaveBeenCalledWith('t-it', { is_active: false });
  });

  it('is refused to anyone but an administrator', async () => {
    signedInAs('staff');
    await render(<RoutingScreen />);
    expect(screen.getByText('Only administrators can change routing.')).toBeOnTheScreen();
    expect(fetchRoutingConfig).not.toHaveBeenCalled();
  });

  it('offers a retry when the settings cannot be loaded', async () => {
    jest
      .mocked(fetchRoutingConfig)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(CONFIG);
    await render(<RoutingScreen />);
    expect(await screen.findByText('Routing settings could not be loaded.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Routing rules')).toBeOnTheScreen();
  });
});
