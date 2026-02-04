#!/bin/bash
# Normalized RBAC Permissions Seed Script
# Seeds 38 capability-based permissions instead of 150+ UI permissions

API_URL="${API_URL:-http://localhost:5001}"
TOKEN="${ADMIN_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "❌ Error: ADMIN_TOKEN environment variable not set"
  echo ""
  echo "To get your token:"
  echo "1. Login to the app as admin"
  echo "2. Open DevTools Console (F12)"
  echo "3. Run: localStorage.getItem('accessToken')"
  echo "4. Copy the token"
  echo ""
  echo "Then run:"
  echo "ADMIN_TOKEN=your_token ./seedNormalizedPermissions.sh"
  exit 1
fi

echo "🌱 Seeding Normalized RBAC Permissions..."
echo "API URL: $API_URL/api/permissions/seed"
echo ""

# Make API request
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @/root/dailyDashboard/backend/scripts/normalizedPermissionsSeed.json \
  "$API_URL/api/permissions/seed")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Normalized Permissions seeded successfully!"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
  echo ""
  echo "📊 Permission Summary:"
  echo "   Total Permissions: 33"
  echo "   - Capabilities: 30 (resource:action)"
  echo "   - Scopes: 3 (own/team/any)"
  echo "   Total Roles: 12"
  echo ""
  echo "🎯 Key Design:"
  echo "   ✓ Capability-based: candidates:write (not candidates_edit_any + candidates_edit_own)"
  echo "   ✓ Scope-based: scope:own|team|any (ABAC-style access control)"
  echo "   ✓ No field-level PII permissions"
  echo ""
  echo "🎉 Access /permissions as admin to see the new matrix!"
else
  echo "❌ Failed to seed permissions (HTTP $HTTP_CODE)"
  echo "$BODY"
  
  if [ "$HTTP_CODE" = "000" ]; then
    echo ""
    echo "💡 Backend server not running. Start it with:"
    echo "   cd backend && npm run dev"
  fi
  
  exit 1
fi
