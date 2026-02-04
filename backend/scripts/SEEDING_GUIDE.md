# Permissions Seeding Guide

## Option 1: Direct Database Seed (Recommended - No Token Required)

This method seeds directly to MongoDB without needing authentication:

```bash
cd /root/dailyDashboard/backend
node src/scripts/seedComprehensivePermissionsDirect.js
```

**Requirements:**
- MongoDB connection string in `.env` (MONGO_URI)
- Database name in `.env` (DB_NAME)

---

## Option 2: Via API (Requires Admin Token)

### Step 1: Get Your Admin Token

**Method A: Login via Frontend**
1. Start the backend: `cd backend && npm run dev`
2. Start the frontend: `cd frontend && npm run dev`
3. Open browser: `http://localhost:3000`
4. Login as admin
5. Open browser DevTools (F12) → Console
6. Run: `localStorage.getItem('accessToken')`
7. Copy the token

**Method B: Login via API**
```bash
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your_password"}'
```

Look for `accessToken` in the response.

### Step 2: Run Seed Script with Token

```bash
cd /root/dailyDashboard/backend
ADMIN_TOKEN=your_token_here ./scripts/seedComprehensivePermissions.sh
```

---

## Verify Seeding

After seeding with either method:

1. Login as admin
2. Navigate to `/permissions`
3. You should see 150+ permissions across 14 categories
4. All 12 roles should have appropriate permissions assigned

---

## Troubleshooting

**"Cannot connect to MongoDB"**
- Check MONGO_URI in `.env` file
- Verify MongoDB is running: `mongosh` or `mongo`

**"Access Denied" on /permissions page**
- Ensure you're logged in as admin
- Check `localStorage.getItem('role')` in browser console
- Should return "admin"

**"No permissions showing"**
- Run seed script again
- Check MongoDB: `db.rolePermissions.find({})`
- Should see 12 documents (one per role)
