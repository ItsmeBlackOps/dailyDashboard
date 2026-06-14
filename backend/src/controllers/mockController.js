// Thin controller over mockRequestService. Auth + role gating is in the
// service (it needs the candidate/watcher context); this maps payloads
// and surfaces the service's statusCode-tagged errors.

import { mockRequestService } from '../services/mockRequestService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const fail = (res, err) =>
  res.status(err.statusCode || 400).json({ success: false, error: err.message });

class MockController {
  // GET /api/mocks/eligible/candidates — picker scope for the create form
  eligibleCandidates = asyncHandler(async (req, res) => {
    try {
      const candidates = await mockRequestService.candidatesForLead(req.user);
      res.json({ success: true, candidates });
    } catch (err) { fail(res, err); }
  });

  // GET /api/mocks/candidate/:emailId/interviews — reference picker
  candidateInterviews = asyncHandler(async (req, res) => {
    try {
      const interviews = await mockRequestService.interviewTasksForCandidate(req.params.emailId);
      res.json({ success: true, interviews });
    } catch (err) { fail(res, err); }
  });

  create = asyncHandler(async (req, res) => {
    try {
      const mock = await mockRequestService.create(req.user, req.body || {});
      res.status(201).json({ success: true, mock });
    } catch (err) {
      logger.warn('mock create failed', { actor: req.user?.email, error: err.message });
      fail(res, err);
    }
  });

  list = asyncHandler(async (req, res) => {
    try {
      const mocks = await mockRequestService.list(req.user, req.query || {});
      res.json({ success: true, mocks });
    } catch (err) { fail(res, err); }
  });

  detail = asyncHandler(async (req, res) => {
    try {
      const mock = await mockRequestService.getDetail(req.user, req.params.id);
      res.json({ success: true, mock });
    } catch (err) { fail(res, err); }
  });

  start = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.start(req.user, req.params.id) }); }
    catch (err) { fail(res, err); }
  });

  callAttempt = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.logCallAttempt(req.user, req.params.id, req.body || {}) }); }
    catch (err) { fail(res, err); }
  });

  schedule = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.schedule(req.user, req.params.id, req.body || {}) }); }
    catch (err) { fail(res, err); }
  });

  blocker = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.raiseBlocker(req.user, req.params.id, req.body || {}) }); }
    catch (err) { fail(res, err); }
  });

  resolveBlocker = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.resolveBlocker(req.user, req.params.id, req.body || {}) }); }
    catch (err) { fail(res, err); }
  });

  checklist = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.toggleChecklist(req.user, req.params.id, req.body || {}) }); }
    catch (err) { fail(res, err); }
  });

  connected = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.markConnected(req.user, req.params.id) }); }
    catch (err) { fail(res, err); }
  });

  feedback = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.submitFeedback(req.user, req.params.id, req.body || {}) }); }
    catch (err) { fail(res, err); }
  });

  cancel = asyncHandler(async (req, res) => {
    try { res.json({ success: true, mock: await mockRequestService.cancel(req.user, req.params.id, req.body || {}) }); }
    catch (err) { fail(res, err); }
  });
}

export const mockController = new MockController();
