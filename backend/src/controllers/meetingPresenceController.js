import { meetingPresenceService } from '../services/meetingPresenceService.js';
import { logger } from '../utils/logger.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class MeetingPresenceController {
  // Authenticated (normal access token via authenticateHTTP). Mints the
  // detector token for the logged-in expert to paste into the extension.
  enroll = asyncHandler(async (req, res) => {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const token = meetingPresenceService.issueDetectorToken(email);
    logger.info('Meeting detector token issued', { email });
    return res.json({ success: true, token, email });
  });

  // Detector token only (via authenticateMeetingDetector → req.detectorEmail).
  report = asyncHandler(async (req, res) => {
    const email = req.detectorEmail;
    const { meetingUrl, state } = req.body || {};

    if (!meetingUrl || typeof meetingUrl !== 'string') {
      return res.status(400).json({ success: false, error: 'meetingUrl is required' });
    }
    const allowed = ['in_call', 'lobby', 'pre_join', 'ended'];
    const normalizedState = allowed.includes(state) ? state : 'in_call';

    const result = await meetingPresenceService.recordPresence({
      email,
      meetingUrl,
      state: normalizedState,
    });

    return res.json({ success: true, ...result });
  });
}

export const meetingPresenceController = new MeetingPresenceController();
