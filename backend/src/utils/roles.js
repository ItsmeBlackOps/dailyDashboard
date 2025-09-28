const ROLE_SYNONYMS = new Map([
  ['manager', new Set(['manager', 'mm'])],
  ['mm', new Set(['manager', 'mm'])]
]);

/**
 * Normalize role strings to a lowercase identifier without surrounding whitespace.
 * Empty or non-string values return an empty string so downstream checks stay predictable.
 *
 * @param {string} role - Role value to normalize.
 * @returns {string} Normalized role or an empty string when input is falsy.
 */
export function normalizeRoleName(role) {
  return (role ?? '')
    .toString()
    .trim()
    .toLowerCase();
}

/**
 * Determine whether two role identifiers should be treated as equivalent, accounting for
 * alias mappings (e.g. treating `mm` as a manager) in addition to simple case-insensitive matches.
 *
 * @param {string} actualRole - The role possessed by a user.
 * @param {string} expectedRole - The allowed or required role to check against.
 * @returns {boolean} True when the roles are equivalent.
 */
export function rolesMatch(actualRole, expectedRole) {
  const normalizedActual = normalizeRoleName(actualRole);
  const normalizedExpected = normalizeRoleName(expectedRole);

  if (!normalizedActual || !normalizedExpected) {
    return false;
  }

  if (normalizedActual === normalizedExpected) {
    return true;
  }

  const expectedAliases = ROLE_SYNONYMS.get(normalizedExpected);
  if (expectedAliases?.has(normalizedActual)) {
    return true;
  }

  const actualAliases = ROLE_SYNONYMS.get(normalizedActual);
  if (actualAliases?.has(normalizedExpected)) {
    return true;
  }

  return false;
}

/**
 * Check whether a provided role appears in a list of allowed roles, applying the same
 * alias-aware comparison used by `rolesMatch`.
 *
 * @param {string} role - Role to test.
 * @param {string[]} allowedRoles - Collection of permitted roles.
 * @returns {boolean} True when the provided role matches any allowed role.
 */
export function hasAnyRole(role, allowedRoles = []) {
  return allowedRoles.some((allowed) => rolesMatch(role, allowed));
}

/**
 * Determine whether the provided role should be treated as a manager role.
 *
 * @param {string} role - Role to evaluate.
 * @returns {boolean} True when the role is a manager or an alias (e.g. MM).
 */
export function isManagerRole(role) {
  return rolesMatch(role, 'manager');
}

/**
 * Determine whether the provided role should be treated as an administrator.
 *
 * @param {string} role - Role to evaluate.
 * @returns {boolean} True when the role is an admin.
 */
export function isAdminRole(role) {
  return normalizeRoleName(role) === 'admin';
}

/**
 * Helper that encapsulates elevated permissions shared by admins and managers (including
 * MM aliases). Use this whenever logic previously checked for just the `manager` role.
 *
 * @param {string} role - Role to evaluate.
 * @returns {boolean} True when the role should have manager-level privileges.
 */
export function hasManagerPrivileges(role) {
  return isAdminRole(role) || isManagerRole(role);
}
