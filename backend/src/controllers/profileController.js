import { profileService } from '../services/profileService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

class ProfileController {
  constructor() {
    this.getCurrentUserProfile = this.getCurrentUserProfile.bind(this);
    this.updateCurrentUserProfile = this.updateCurrentUserProfile.bind(this);
  }

  getCurrentUserProfile = asyncHandler(async (req, res) => {
    const { email } = req.user;
    const result = await profileService.getProfile(email);
    res.status(200).json(result);
  });

  updateCurrentUserProfile = asyncHandler(async (req, res) => {
    const { email } = req.user;
    const { displayName, jobRole, phoneNumber } = req.body ?? {};
    const result = await profileService.updateProfile(email, { displayName, jobRole, phoneNumber });
    res.status(200).json(result);
  });
}

export const profileController = new ProfileController();
