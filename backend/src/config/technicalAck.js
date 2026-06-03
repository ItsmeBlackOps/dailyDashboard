// SP2 — the one-time technical-team acknowledgment. Bump `version` to
// re-prompt the whole technical team after editing the wording.
export const TECHNICAL_ACK = {
  version: 1,
  title: 'Technical Team — Before You Start Meetings',
  sections: [
    'You must toggle the "Meeting Started" button before starting each meeting.',
    'This is mandatory — a meeting will not be considered started unless you toggle it.',
  ],
};

// Legacy role tokens that must acknowledge (req.user.role is already legacy).
export const TECHNICAL_ACK_ROLES = ['user', 'am', 'lead'];
