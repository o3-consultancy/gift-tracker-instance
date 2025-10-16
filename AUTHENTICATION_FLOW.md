# API Key Authentication Flow

## 🔐 Overview

The tracker instance now requires users to enter an API Key before accessing the dashboard. This provides an extra layer of security beyond the server-side configuration.

---

## 🔄 Authentication Flow

```
User visits http://localhost:3000
         ↓
    index.html (redirect logic)
         ↓
    ┌─────────────────────┐
    │ Has API Key stored? │
    └─────────────────────┘
         ↓           ↓
        YES          NO
         ↓           ↓
    dashboard.html  login.html
         ↓           ↓
    Validate Key    Enter Key
         ↓           ↓
    ┌─────────────────────┐
    │ POST /api/validate  │
    └─────────────────────┘
         ↓           ↓
      VALID      INVALID
         ↓           ↓
    Show Dashboard  unauthorized.html
```

---

## 📁 Files Created/Modified

### New Files:
1. **`public/login.html`** - API Key entry page
2. **`public/unauthorized.html`** - Unauthorized access page
3. **`public/index.html`** - Redirect logic (NEW)
4. **`public/dashboard.html`** - Renamed from index.html

### Modified Files:
1. **`server/index.js`** - Added `/api/validate` endpoint

---

## 🔑 Testing the Authentication

### 1. Start the Server

```bash
node server/index.js
```

### 2. Visit the Tracker

```
http://localhost:3000
```

**Expected:** Redirects to `/login.html`

### 3. Enter API Key

**Your API Key (from .env):**
```
672eb4f8-f94a-4c14-b3d3-7df035c46af7
```

**Test Scenarios:**

#### ✅ **Correct API Key**
- Enter: `672eb4f8-f94a-4c14-b3d3-7df035c46af7`
- Click "Access Dashboard"
- **Expected:** Redirects to dashboard, shows tracker interface

#### ❌ **Wrong API Key**
- Enter: `wrong-key-123`
- Click "Access Dashboard"
- **Expected:** Shows error "Invalid API Key"

#### ⚠️ **Empty API Key**
- Leave field empty
- Click "Access Dashboard"
- **Expected:** Shows error "Please enter an API Key"

---

## 🧪 API Endpoint Testing

### Endpoint: `POST /api/validate`

**Test with cURL:**

#### Correct Key:
```bash
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"672eb4f8-f94a-4c14-b3d3-7df035c46af7"}'
```

**Expected Response:**
```json
{
  "success": true,
  "accountId": "68f0c3e9f05516c475153956",
  "tiktokUsername": "sl.liveshow"
}
```

#### Wrong Key:
```bash
curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"wrong-key"}'
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Invalid API Key"
}
```

---

## 📝 Session Storage

Once authenticated, the browser stores:

```javascript
sessionStorage.setItem('tracker_api_key', 'your-api-key');
sessionStorage.setItem('tracker_account_id', '68f0c3e9f05516c475153956');
sessionStorage.setItem('tracker_username', 'sl.liveshow');
```

**To test logout:**
Open browser console and run:
```javascript
sessionStorage.clear();
location.reload();
```

**Expected:** Redirects back to login page

---

## 🎨 UI Features

### Login Page
- ✅ Modern gradient design
- ✅ Password field for API Key (hidden by default)
- ✅ Error messages with shake animation
- ✅ Loading spinner during validation
- ✅ Success animation on valid key
- ✅ Responsive design

### Unauthorized Page
- ✅ Clear 401 error message
- ✅ "Enter API Key" button
- ✅ "Go Back" button
- ✅ Help text for users
- ✅ Animated lock icon

---

## 🔒 Security Features

### Frontend Security:
1. **Session-based storage** - API Key stored in sessionStorage (cleared on browser close)
2. **Automatic validation** - Dashboard checks API Key on load
3. **Redirect protection** - Invalid keys redirect to unauthorized page

### Backend Security:
1. **Server-side validation** - API Key must match server's .env
2. **No exposure** - Server's API Key never sent to client
3. **Simple comparison** - Direct string comparison (can be enhanced with hashing)

---

## 🛠️ Customization

### Change API Key Prompt Text

Edit `public/login.html`:
```html
<h1 class="login-title">Tracker Access</h1>
<p class="login-subtitle">Enter your API Key to access this tracker instance</p>
```

### Change Unauthorized Message

Edit `public/unauthorized.html`:
```html
<h2 class="error-subtitle">Unauthorized Access</h2>
<p class="error-message">
  You don't have permission to access this tracker instance.
</p>
```

### Disable Authentication (for testing)

To bypass authentication temporarily:

1. Comment out authentication check in `public/dashboard.html`:
```javascript
// (function() {
//   const apiKey = sessionStorage.getItem('tracker_api_key');
//   if (!apiKey) {
//     window.location.href = '/login.html';
//     return;
//   }
// })();
```

2. Or set API Key in console:
```javascript
sessionStorage.setItem('tracker_api_key', '672eb4f8-f94a-4c14-b3d3-7df035c46af7');
```

---

## 📊 URL Structure

| URL | Purpose | Auth Required |
|-----|---------|---------------|
| `/` | Redirect to login or dashboard | No |
| `/login.html` | API Key entry form | No |
| `/dashboard.html` | Main tracker interface | Yes |
| `/unauthorized.html` | Access denied page | No |
| `/overlay.html` | Gift overlay (for OBS) | No |
| `/api/validate` | Validate API Key | No |

---

## 🐛 Troubleshooting

### "Redirecting..." stuck on screen
- **Issue:** JavaScript redirect not working
- **Solution:** Check browser console for errors

### Can't access dashboard after entering correct key
- **Issue:** Session storage not working
- **Solution:**
  1. Check browser allows sessionStorage
  2. Try incognito mode
  3. Check `/api/validate` endpoint is responding

### API validation fails
- **Issue:** Server's API Key doesn't match
- **Solution:**
  1. Check `.env` file has correct `API_KEY`
  2. Restart server after changing `.env`
  3. Copy API Key exactly (no spaces)

### Dashboard keeps redirecting to login
- **Issue:** API Key validation failing
- **Solution:**
  1. Open browser DevTools → Network tab
  2. Check `/api/validate` request
  3. Verify API Key in request body matches server

---

## ✅ Checklist for Testing

- [ ] Server starts without errors
- [ ] Visiting `/` redirects to `/login.html`
- [ ] Can enter API Key in login form
- [ ] Wrong API Key shows error message
- [ ] Correct API Key redirects to dashboard
- [ ] Dashboard loads and displays tracker
- [ ] Can connect to TikTok Live
- [ ] Session persists on page refresh
- [ ] Clearing session redirects to login
- [ ] `/unauthorized.html` shows proper error page

---

## 🎯 Next Steps After Testing

1. **If authentication works:**
   - Test with real TikTok stream
   - Verify gift tracking still works
   - Test with multiple browser tabs
   - Test session expiry behavior

2. **If issues found:**
   - Note specific error messages
   - Check browser console logs
   - Check server logs
   - Review network requests in DevTools

3. **Enhancement ideas:**
   - Add "Remember me" option
   - Add password reset/regenerate flow
   - Add rate limiting on validation endpoint
   - Add session timeout (auto-logout after X hours)

---

**Your API Key for testing:**
```
672eb4f8-f94a-4c14-b3d3-7df035c46af7
```

**Server URL:**
```
http://localhost:3000
```

**Ready to test! 🚀**
