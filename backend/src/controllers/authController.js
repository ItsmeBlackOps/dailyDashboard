import { authService } from '../services/authService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export class AuthController {
  constructor() {
    this.authService = authService;
  }

  login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const result = await this.authService.login(email, password);

    res.status(200).json(result);
  });

  refresh = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    const result = await this.authService.refreshAccessToken(refreshToken);

    res.status(200).json(result);
  });

  logout = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    const result = await this.authService.logout(refreshToken);

    res.status(200).json(result);
  });

  logoutAll = asyncHandler(async (req, res) => {
    const userEmail = req.user.email;

    const result = await this.authService.logoutAllSessions(userEmail);

    res.status(200).json(result);
  });

  getProfile = asyncHandler(async (req, res) => {
    const userEmail = req.user.email;

    const profile = this.authService.getUserProfile(userEmail);

    res.status(200).json({
      success: true,
      profile
    });
  });

  updateProfile = asyncHandler(async (req, res) => {
    const userEmail = req.user.email;
    const updateData = req.body;

    // Remove sensitive fields that shouldn't be updated via this endpoint
    delete updateData.role;
    delete updateData.email;

    const result = await this.authService.updateUser(userEmail, updateData);

    res.status(200).json(result);
  });

  createUser = asyncHandler(async (req, res) => {
    const userData = req.body;

    const result = await this.authService.createUser(userData);

    res.status(201).json(result);
  });

  getStats = asyncHandler(async (req, res) => {
    const stats = this.authService.getAuthStats();

    res.status(200).json({
      success: true,
      stats
    });
  });

  healthCheck = asyncHandler(async (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Auth service is healthy',
      timestamp: new Date().toISOString()
    });
  });
}

export const authController = new AuthController();