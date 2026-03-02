import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleDetailRequiredDialog } from './RoleDetailRequiredDialog';

const refresh = vi.fn();
const authFetch = vi.fn();
const toast = vi.fn();

vi.mock('@/contexts/UserProfileContext', () => ({
  useUserProfile: () => ({
    profile: {
      email: 'user@example.com',
      displayName: 'User Example',
      phoneNumber: '+1 (555) 123-4567',
      companyName: 'Silverspace Inc.',
      companyUrl: 'https://www.silverspaceinc.com',
      jobRole: 'DATA',
      isComplete: false,
      requiresRoleDetailSelection: true,
      allowedRoleDetails: ['DATA', 'DEVELOPER', 'DEVOPS']
    },
    saving: false,
    refresh
  })
}));

vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => ({ authFetch })
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast })
}));

describe('RoleDetailRequiredDialog', () => {
  beforeEach(() => {
    refresh.mockReset();
    authFetch.mockReset();
    toast.mockReset();
    localStorage.setItem('role', 'user');
    authFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });
  });

  it('shows mandatory note when role-detail selection is required', () => {
    render(<RoleDetailRequiredDialog />);
    expect(screen.getByText('Select Your Role Detail')).toBeTruthy();
    expect(
      screen.getByText('Select the most relevant role you are working for. This is mandatory.')
    ).toBeTruthy();
  });

  it('submits selected role detail with existing profile values', async () => {
    render(<RoleDetailRequiredDialog />);

    fireEvent.click(screen.getAllByText('Save')[0]);

    await waitFor(() => {
      expect(authFetch).toHaveBeenCalledWith(
        'http://localhost:3004/api/profile/me/role-detail',
        expect.objectContaining({
          method: 'PUT'
        })
      );
    });
  });
});
