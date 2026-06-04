// Route entry for /user-management.
//
// The implementation moved to the feature module
// (@/features/userManagement/UserManagementPage) as part of the User
// Management redesign. This file is kept as the route's import target so
// the lazy route in App.tsx — lazyWithRetry(() => import('./pages/UserManagement'))
// — keeps resolving to a default export unchanged.
export { UserManagementPage as default } from '@/features/userManagement/UserManagementPage';
