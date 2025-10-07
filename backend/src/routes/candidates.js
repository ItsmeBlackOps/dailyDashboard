import express from 'express';
import multer from 'multer';
import { authenticateHTTP } from '../middleware/auth.js';
import { candidateController } from '../controllers/candidateController.js';
import { config } from '../config/index.js';

const router = express.Router();

const maxFileSize = config.storage?.maxResumeBytes ?? 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxFileSize,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (/^application\/pdf$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error('Only PDF resumes are allowed');
      error.statusCode = 400;
      cb(error);
    }
  }
});

router.use(authenticateHTTP);

router.post('/resume', upload.single('resume'), (req, res) =>
  candidateController.uploadResume(req, res)
);

export default router;
