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

// PRT Phase 2: candidate attachment uploads — broader MIME allowlist
// (pdf/docx/xlsx/png/jpeg), 10 MB cap by default. Lives separately so
// the existing /resume route stays single-PDF.
const ATTACHMENT_ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg'
]);
const attachmentMaxBytes = config.storage?.maxAttachmentBytes ?? 10 * 1024 * 1024;
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: attachmentMaxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const mt = (file.mimetype || '').toLowerCase();
    if (ATTACHMENT_ALLOWED_MIMES.has(mt)) {
      cb(null, true);
    } else {
      const error = new Error('Unsupported attachment type. Allowed: pdf, docx, xlsx, png, jpeg');
      error.statusCode = 400;
      cb(error);
    }
  }
});

// PRT — "additional attachments" accept ANY format (no MIME allowlist),
// same 10 MB cap. Low-risk: files are served via the authenticated
// streaming proxy and never executed. The resume slot keeps the
// whitelisted `attachmentUpload` above.
const additionalAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: attachmentMaxBytes, files: 1 }
});

router.use(authenticateHTTP);

router.post('/resume', upload.single('resume'), (req, res) =>
  candidateController.uploadResume(req, res)
);

router.get('/po-missing-date', (req, res) =>
  candidateController.getPOMissingDate(req, res)
);

router.get('/active-names',     (req, res) => candidateController.getActiveCandidateNames(req, res));
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
router.get('/hub-workload',  (req, res) => candidateController.getHubWorkload(req, res));
router.get('/distinct-clients', (req, res) => candidateController.getDistinctClients(req, res));
router.post('/end-clients', (req, res) => candidateController.addEndClient(req, res));
router.post('/:id/derive-profile', (req, res) => candidateController.deriveProfile(req, res));
router.get('/:id/forge-profile',  (req, res) => candidateController.getForgeProfile(req, res));
router.get('/:id/status-history', (req, res) => candidateController.getStatusHistory(req, res));
router.post('/:id/status',        (req, res) => candidateController.updateStatus(req, res));

// PRT Phase 2: attachment endpoints. Placed BEFORE the generic /:id route
// to keep route resolution predictable, even though Express's segment
// matcher would not actually confuse them.
router.post(
  '/:id/attachments',
  attachmentUpload.single('file'),
  (req, res) => candidateController.uploadAttachment(req, res)
);
// PRT — additional attachments: any format, same 10 MB cap, same handler.
router.post(
  '/:id/attachments/additional',
  additionalAttachmentUpload.single('file'),
  (req, res) => candidateController.uploadAttachment(req, res)
);
router.delete(
  '/:id/attachments/:attachmentId',
  (req, res) => candidateController.deleteAttachment(req, res)
);
router.get(
  '/:id/attachments/:attachmentId/download',
  (req, res) => candidateController.downloadAttachment(req, res)
);
router.post(
  '/:id/attachments/:attachmentId/set-as-resume',
  (req, res) => candidateController.setAttachmentAsResume(req, res)
);

// PRT Phase 3: Assignment Email send.
router.post(
  '/:id/send-assignment-email',
  (req, res) => candidateController.sendAssignmentEmail(req, res)
);

router.get('/:id',            (req, res) => candidateController.getCandidateById(req, res));

export default router;
