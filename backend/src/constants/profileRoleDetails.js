export const ROLE_DETAIL_OPTIONS = ['DATA', 'DEVELOPER', 'DEVOPS'];

export const normalizeRoleDetail = (value = '') =>
  (value || '').toString().trim().toUpperCase();

export const isValidUserRoleDetail = (value = '') =>
  ROLE_DETAIL_OPTIONS.includes(normalizeRoleDetail(value));

