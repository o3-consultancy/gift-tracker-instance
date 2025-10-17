# 🧪 Quick Testing Guide

## Start Server
```bash
node server/index.js
```

## Your API Key
```
672eb4f8-f94a-4c14-b3d3-7df035c46af7
```

## Test URLs
- Main: http://localhost:3000
- Login: http://localhost:3000/login.html
- Dashboard: http://localhost:3000/dashboard.html
- Unauthorized: http://localhost:3000/unauthorized.html

## Quick Tests

### 1. First Visit
- Visit http://localhost:3000
- Should redirect to login page

### 2. Login
- Enter API Key: `672eb4f8-f94a-4c14-b3d3-7df035c46af7`
- Click "Access Dashboard"
- Should show dashboard

### 3. Test Invalid Key
- Logout (clear sessionStorage)
- Enter wrong key: `wrong-key-123`
- Should show error

### 4. Test Session
- After successful login, refresh page
- Should stay on dashboard (not redirect to login)

## Debug Commands

### Check API validation (Terminal)
```bash
# Valid key
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"672eb4f8-f94a-4c14-b3d3-7df035c46af7"}'

# Invalid key
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"wrong"}'
```

### Logout (Browser Console)
```javascript
sessionStorage.clear();
location.reload();
```

### Check stored session (Browser Console)
```javascript
console.log(sessionStorage.getItem('tracker_api_key'));
```

## Expected Flow
```
1. Visit / → Redirects to /login.html
2. Enter API Key → POST /api/validate
3. Valid Key → Redirect to /dashboard.html
4. Invalid Key → Show error, stay on login
5. Dashboard loads → Validates session
6. Valid session → Show tracker
7. Invalid session → Redirect to /unauthorized.html
```

✅ Everything working? Great!
❌ Issues? Check AUTHENTICATION_FLOW.md for troubleshooting
