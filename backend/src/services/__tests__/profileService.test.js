import { jest } from '@jest/globals';

const mockUserModel = {
  getUserProfileMetadata: jest.fn(),
  upsertUserProfileMetadata: jest.fn(),
  getUserByEmail: jest.fn()
};

jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: mockUserModel
}));

const { profileService } = await import('../profileService.js');

describe('profileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserModel.getUserByEmail.mockReturnValue({ role: 'recruiter' });
  });

  describe('getProfile', () => {
    it('returns derived defaults when metadata is missing', async () => {
      mockUserModel.getUserProfileMetadata.mockResolvedValue(null);

      const result = await profileService.getProfile('user@silverspaceinc.com');

      expect(result.success).toBe(true);
      expect(result.profile.email).toBe('user@silverspaceinc.com');
      expect(result.profile.companyName).toBe('Silverspace Inc.');
      expect(result.profile.companyUrl).toBe('https://www.silverspaceinc.com');
      expect(result.profile.displayName).toBe('User');
      expect(result.profile.isComplete).toBe(false);
      expect(result.profile.requiresRoleDetailSelection).toBe(false);
      expect(result.profile.allowedRoleDetails).toEqual(['DATA', 'DEVELOPER', 'DEVOPS']);
    });

    it('requires role detail selection for role user when job role is invalid', async () => {
      mockUserModel.getUserByEmail.mockReturnValue({ role: 'user' });
      mockUserModel.getUserProfileMetadata.mockResolvedValue({
        metadata: { jobRole: 'Senior Recruiter' }
      });

      const result = await profileService.getProfile('user@silverspaceinc.com');
      expect(result.profile.requiresRoleDetailSelection).toBe(true);
    });

    it('does not require role detail selection for role user with valid value', async () => {
      mockUserModel.getUserByEmail.mockReturnValue({ role: 'user' });
      mockUserModel.getUserProfileMetadata.mockResolvedValue({
        metadata: { jobRole: 'developer' }
      });

      const result = await profileService.getProfile('user@silverspaceinc.com');
      expect(result.profile.jobRole).toBe('DEVELOPER');
      expect(result.profile.requiresRoleDetailSelection).toBe(false);
    });
  });

  describe('updateProfile', () => {
    it('formats payload and persists metadata', async () => {
      mockUserModel.upsertUserProfileMetadata.mockResolvedValue({ acknowledged: true });

      const result = await profileService.updateProfile('agent@vizvaconsultancyservices.com', {
        displayName: ' <b>Agent</b> One ',
        jobRole: ' Senior Recruiter ',
        phoneNumber: '5551234567'
      });

      expect(result.success).toBe(true);
      expect(mockUserModel.upsertUserProfileMetadata).toHaveBeenCalledWith(
        'agent@vizvaconsultancyservices.com',
        expect.objectContaining({
          displayName: 'Agent One',
          jobRole: 'Senior Recruiter',
          phoneNumber: '+1 (555) 123-4567',
          companyName: 'Vizva Consultancy Services',
          companyUrl: 'https://www.vizvaconsultancyservices.com'
        })
      );
      expect(result.profile.phoneNumber).toBe('+1 (555) 123-4567');
    });

    it('throws when required fields missing', async () => {
      await expect(
        profileService.updateProfile('user@silverspaceinc.com', {
          displayName: '',
          jobRole: '',
          phoneNumber: ''
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects phone numbers that do not match required format', async () => {
      await expect(
        profileService.updateProfile('user@silverspaceinc.com', {
          displayName: 'User Example',
          jobRole: 'Recruiter',
          phoneNumber: '+44 020 1234 5678'
        })
      ).rejects.toMatchObject({ statusCode: 400, message: 'Phone number must follow +1 (123) 456-7890 format' });
    });

    it('surface errors from persistence layer', async () => {
      const persistenceError = new Error('write failed');
      mockUserModel.upsertUserProfileMetadata.mockRejectedValueOnce(persistenceError);

      await expect(
        profileService.updateProfile('user@silverspaceinc.com', {
          displayName: 'User Example',
          jobRole: 'Recruiter',
          phoneNumber: '5551234567'
        })
      ).rejects.toBe(persistenceError);

      expect(mockUserModel.upsertUserProfileMetadata).toHaveBeenCalledWith(
        'user@silverspaceinc.com',
        expect.objectContaining({
          displayName: 'User Example',
          jobRole: 'Recruiter',
          phoneNumber: '+1 (555) 123-4567'
        })
      );
    });

    it('rejects unsupported job role for role user', async () => {
      mockUserModel.getUserByEmail.mockReturnValue({ role: 'user' });

      await expect(
        profileService.updateProfile('user@silverspaceinc.com', {
          displayName: 'User Example',
          jobRole: 'Recruiter',
          phoneNumber: '5551234567'
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Job role must be one of: DATA, DEVELOPER, DEVOPS'
      });
    });

    it('accepts valid enum job role for role user and stores uppercase', async () => {
      mockUserModel.getUserByEmail.mockReturnValue({ role: 'user' });
      mockUserModel.upsertUserProfileMetadata.mockResolvedValue({ acknowledged: true });

      await profileService.updateProfile('user@silverspaceinc.com', {
        displayName: 'User Example',
        jobRole: 'developer',
        phoneNumber: '5551234567'
      });

      expect(mockUserModel.upsertUserProfileMetadata).toHaveBeenCalledWith(
        'user@silverspaceinc.com',
        expect.objectContaining({
          jobRole: 'DEVELOPER'
        })
      );
    });
  });

  describe('updateRoleDetail', () => {
    it('updates only role detail for role user', async () => {
      mockUserModel.getUserByEmail.mockReturnValue({ role: 'user' });
      mockUserModel.getUserProfileMetadata.mockResolvedValue({
        metadata: {
          displayName: 'User Example',
          jobRole: '',
          phoneNumber: '+1 (555) 123-4567',
          companyName: 'Silverspace Inc.',
          companyUrl: 'https://www.silverspaceinc.com'
        }
      });
      mockUserModel.upsertUserProfileMetadata.mockResolvedValue({ acknowledged: true });

      const result = await profileService.updateRoleDetail('user@silverspaceinc.com', { jobRole: 'data' });

      expect(result.success).toBe(true);
      expect(mockUserModel.upsertUserProfileMetadata).toHaveBeenCalledWith(
        'user@silverspaceinc.com',
        expect.objectContaining({
          jobRole: 'DATA',
          displayName: 'User Example',
          phoneNumber: '+1 (555) 123-4567'
        })
      );
    });

    it('rejects updateRoleDetail for non-user role', async () => {
      mockUserModel.getUserByEmail.mockReturnValue({ role: 'recruiter' });

      await expect(
        profileService.updateRoleDetail('recruiter@silverspaceinc.com', { jobRole: 'DATA' })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
