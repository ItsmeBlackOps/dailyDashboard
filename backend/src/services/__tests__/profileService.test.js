import { jest } from '@jest/globals';

const mockUserModel = {
  getUserProfileMetadata: jest.fn(),
  upsertUserProfileMetadata: jest.fn()
};

jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: mockUserModel
}));

const { profileService } = await import('../profileService.js');

describe('profileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});
