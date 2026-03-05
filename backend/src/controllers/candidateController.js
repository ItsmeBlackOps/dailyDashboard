import { storageService } from '../services/storageService.js';
import { logger } from '../utils/logger.js';

class CandidateController {
  async uploadResume(req, res) {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const normalizedRole = (user.role || '').trim().toLowerCase();
      if (!['manager', 'admin', 'mm', 'mam', 'mlead', 'recruiter'].includes(normalizedRole)) {
        return res.status(403).json({
          success: false,
          error: 'Only managers can upload resumes'
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Resume file is required'
        });
      }

      const { buffer, mimetype, originalname } = file;

      const result = await storageService.uploadResume({
        buffer,
        contentType: mimetype,
        originalName: originalname,
        uploadedBy: user.email
      });

      return res.status(201).json({
        success: true,
        resumeLink: result.resumeLink,
        objectKey: result.objectKey
      });
    } catch (error) {
      logger.error('Resume upload handler failed', {
        error: error.message,
        userEmail: req.user?.email
      });

      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode === 400 ? error.message : 'Unable to upload resume'
      });
    }
  }
}

export const candidateController = new CandidateController();
