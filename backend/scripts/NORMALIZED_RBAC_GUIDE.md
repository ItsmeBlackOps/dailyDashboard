# Normalized RBAC Permissions Model

## Overview

This system uses a **normalized RBAC (Role-Based Access Control)** model with three layers:

1. **Capabilities** (resource:action) - ~30 permissions
2. **Scopes** (ABAC-style) - 3 permissions
3. **Field-Level** (PII only) - 5 permissions

**Total: 38 permissions** instead of 150+ granular UI permissions.

---

## Design Principles

### ✅ DO: Use Capabilities
Instead of: `candidates_edit_any` + `candidates_edit_own` + 10 field permissions  
Use: `candidates:write` + `scope:any|team|own` + `candidates:pii:read` (for email/contact)

### ✅ DO: Use Scopes
- `scope:own` - Can only access own records
- `scope:team` - Can access team records
- `scope:any` - No restrictions, can access all records

### ✅ DO: Field-Level for PII Only
Use field-level permissions ONLY for genuinely sensitive data:
- `candidates:pii:read` - Email/Contact
- `users:pii:read` - Email/Contact
- `users:salary:read` - Compensation data

### ❌ DON'T: Column-level permissions
Most "view column" permissions are unnecessary. Don't create:
- `tasks_view_expert_column`
- `candidates_view_email_column`
- etc.

---

## Permission Structure

### Capabilities (30)

**Dashboard:**
- `dashboard:read`

**Tasks:**
- `tasks:read`, `tasks:write`, `tasks:assign`, `tasks:meeting`, `tasks:delete`, `tasks:support`, `tasks:mock`

**Candidates:**
- `candidates:read`, `candidates:write`, `candidates:delete`, `candidates:export`, `candidates:import`

**Resumes:**
- `resumes:read`, `resumes:review`, `resumes:assign`, `resumes:download`

**Users:**
- `users:read`, `users:manage`, `users:roles`

**Reports:**
- `reports:read`, `reports:export`, `reports:schedule`

**System:**
- `alerts:manage`, `system:settings`, `audit:read`

**Notifications:**
- `notifications:read`, `notifications:manage`

**Profile:**
- `profile:read`, `profile:write`

**Permissions:**
- `permissions:manage`

### Scopes (3)
- `scope:own` - Own records only
- `scope:team` - Team records
- `scope:any` - All records

### Field-Level (5)
- `candidates:pii:read` - Candidate email/contact
- `users:pii:read` - User email/contact  
- `users:salary:read` - Compensation

---

## Usage Examples

### Frontend Check
```typescript
import { hasCapability, canAccessField } from '@/config/permissions';

// Check if user can write candidates (with scope check)
if (hasCapability(permissions, 'candidates:write', 'team')) {
  // User can edit team candidates
}

// Check if user can see PII
if (canAccessField(permissions, 'candidates:pii:read')) {
  // Show email/contact columns
}
```

### Backend Middleware
```javascript
function requirePermission(capability, scope = 'own') {
  return (req, res, next) => {
    const { permissions } = req.user;
    
    if (!hasCapability(permissions, capability, scope)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

// Usage
router.put('/candidates/:id', requirePermission('candidates:write', 'any'), updateCandidate);
```

---

## Role Examples

### Admin (38 permissions)
- All capabilities + `scope:any` + all field-level permissions

### Manager (scope:team)
```json
[
  "dashboard:read",
  "tasks:read", "tasks:write", "tasks:assign", "tasks:meeting",
  "candidates:read", "candidates:write", "candidates:pii:read",
  "resumes:read", "resumes:review",
  "users:read", "users:manage",
  "notifications:read",
  "profile:read", "profile:write",
  "scope:team"
]
```

### Recruiter (scope:own)
```json
[
  "dashboard:read",
  "tasks:read", "tasks:write", "tasks:support", "tasks:mock",
  "candidates:read", "candidates:write", "candidates:pii:read",
  "resumes:read",
  "notifications:read",
  "profile:read", "profile:write",
  "scope:own"
]
```

---

## Seeding Data

```bash
# Start backend server
cd backend && npm run dev

# In another terminal, seed permissions
cd backend
ADMIN_TOKEN=your_token ./scripts/seedNormalizedPermissions.sh
```

---

## Benefits

1. **Maintainable**: 38 permissions vs 150+
2. **Flexible**: Scopes provide dynamic access control
3. **Secure**: Field-level only for truly sensitive data
4. **Scalable**: Easy to add new capabilities
5. **Clear**: Explicit resource:action naming
