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

router.get('/po-missing-date', (req, res) =>
  candidateController.getPOMissingDate(req, res)
);

router.get('/hub-stats',      (req, res) => candidateController.getHubStats(req, res));
router.get('/hub-profiles',   (req, res) => candidateController.getHubProfiles(req, res));
router.get('/hub-recruiters', (req, res) => candidateController.getHubRecruiters(req, res));
router.get('/hub-alerts',     (req, res) => candidateController.getHubAlerts(req, res));
router.get('/hub-po',         (req, res) => candidateController.getHubPO(req, res));
router.get('/grouped',        (req, res) => candidateController.getGrouped(req, res));
router.get('/task/:taskId',   (req, res) => candidateController.getTaskById(req, res));
router.get('/hub-config',    (req, res) => candidateController.getHubConfig(req, res));
router.put('/hub-config',    (req, res) => candidateController.updateHubConfig(req, res));
router.get('/hub-aging',     (req, res) => candidateController.getHubAging(req, res));
router.get('/:id',            (req, res) => candidateController.getCandidateById(req, res));

export default router;
