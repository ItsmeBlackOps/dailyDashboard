import express from 'express';
import multer from 'multer';
import { authenticateHTTP } from '../middleware/auth.js';
import { supportRequestController } from '../controllers/supportRequestController.js';
import { config } from '../config/index.js';

const router = express.Router();

const attachmentLimit = config.support?.attachmentMaxBytes ?? 5 * 1024 * 1024;

const memoryStorage = multer.memoryStorage();

const interviewUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: attachmentLimit,
    files: 8,
  },
  fileFilter: (req, file, cb) => {
    if (/^application\/pdf$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error('Only PDF files are allowed');
      error.statusCode = 400;
      cb(error);
    }
  },
});

const assessmentUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: attachmentLimit,
    files: 8,
  },
});

router.use(authenticateHTTP);

router.post(
  '/interview',
  interviewUpload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'jobDescription', maxCount: 1 },
    { name: 'additionalAttachments', maxCount: 6 },
  ]),
  supportRequestController.createInterviewSupport
);

router.post(
  '/assessment',
  assessmentUpload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'assessmentInfo', maxCount: 1 },
    { name: 'additionalAttachments', maxCount: 6 },
  ]),
  supportRequestController.createAssessmentSupport
);

router.post(
  '/mock',
  supportRequestController.createMockSupport
);

export default router;
