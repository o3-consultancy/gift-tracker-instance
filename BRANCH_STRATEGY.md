# Branch Strategy - TikTok Gift Tracker Instance

## Overview
This repository uses a multi-branch strategy to manage different editions and customer-specific deployments of the TikTok Gift Tracker.

## Branch Structure

### Core Branches

#### `main`
- **Purpose**: Stable production release
- **Use Case**: General deployments
- **Features**: Standard gift tracking functionality
- **Updates**: Only via PR from backend-integration-v2 or feature branches

#### `backend-integration-v2`
- **Purpose**: Latest stable version with all fixes and enhancements
- **Use Case**: Development and testing of new features
- **Features**:
  - Auto-reconnection with exponential backoff (5 attempts)
  - Gift combo tracking with timeout fallback
  - Connection health monitoring
  - Error logging and diagnostics
  - Broadcast debouncing and backend sync batching
- **Updates**: Active development branch

---

### Enterprise Edition Branches

#### `enterprise` (TEMPLATE)
- **Purpose**: Master template for enterprise customers
- **Use Case**: Branch from this for new enterprise customers
- **Features**:
  - Three overlay themes (Gold Premium, White Elegant, Classic Cyan)
  - Overlay style selection per group
  - Transparent overlay backgrounds
  - No info panel tooltips
  - Clean minimal design for professional streaming
- **Updates**: Only for new enterprise features that should be available to all enterprise customers
- **DO NOT**: Use for customer-specific customizations

#### Customer-Specific Enterprise Branches

##### `canaan-enterprise`
- **Customer**: Canaan (lightx0fficial)
- **Deployed On**: Production server port 3001
- **Customizations**: Based on enterprise template
- **Environment**:
  - API_KEY: `9368687c-61dd-4d66-8070-f7456c34aa7d`
  - ACCOUNT_ID: `6900909fe9c8f2d440773977`
  - TIKTOK_USERNAME: `lightx0fficial`

##### `professional`
- **Customer**: Professional tier customers
- **Purpose**: Premium features for professional streamers
- **Features**: Same as enterprise template
- **Use Case**: Deploy for customers who need enterprise features

---

## Branch Workflow

### Creating a New Enterprise Customer Branch

1. **Branch from enterprise template:**
   ```bash
   git checkout enterprise
   git pull origin enterprise
   git checkout -b <customer-name>-enterprise
   ```

2. **Make customer-specific customizations:**
   - Update overlay colors/branding
   - Add custom features
   - Configure environment variables

3. **Push to remote:**
   ```bash
   git push -u origin <customer-name>-enterprise
   ```

4. **Deploy to production:**
   ```bash
   docker build -t gift-tracker:<customer-name>-enterprise .
   docker run -d \
     --name gift-tracker-<customer-name> \
     -p <port>:3000 \
     -e API_KEY="<customer-api-key>" \
     -e ACCOUNT_ID="<customer-account-id>" \
     -e TIKTOK_USERNAME="<customer-username>" \
     gift-tracker:<customer-name>-enterprise
   ```

### Updating Enterprise Template

When adding features that should be available to ALL enterprise customers:

1. **Update enterprise branch:**
   ```bash
   git checkout enterprise
   # Make changes
   git commit -m "Add new enterprise feature"
   git push origin enterprise
   ```

2. **Merge into customer branches:**
   ```bash
   git checkout <customer-name>-enterprise
   git merge enterprise
   # Resolve conflicts if any
   git push origin <customer-name>-enterprise
   ```

### Updating Individual Customer Branch

For customer-specific features or fixes:

1. **Work directly on customer branch:**
   ```bash
   git checkout <customer-name>-enterprise
   # Make changes
   git commit -m "Customer-specific change"
   git push origin <customer-name>-enterprise
   ```

2. **Rebuild and redeploy:**
   ```bash
   docker build -t gift-tracker:<customer-name>-enterprise .
   docker stop gift-tracker-<customer-name>
   docker rm gift-tracker-<customer-name>
   docker run -d --name gift-tracker-<customer-name> [...]
   ```

---

## Current Deployments

| Customer | Branch | Port | TikTok Username | Status |
|----------|--------|------|-----------------|--------|
| Canaan | `canaan-enterprise` | 3001 | @lightx0fficial | Active |
| - | `professional` | - | - | Template |

---

## Feature Comparison

| Feature | main | backend-integration-v2 | enterprise | professional |
|---------|------|------------------------|------------|--------------|
| Basic gift tracking | ✅ | ✅ | ✅ | ✅ |
| Auto-reconnection | ❌ | ✅ | ✅ | ✅ |
| Gift combo tracking | ❌ | ✅ | ✅ | ✅ |
| Health monitoring | ❌ | ✅ | ✅ | ✅ |
| Error logging | ❌ | ✅ | ✅ | ✅ |
| Multiple overlay themes | ❌ | ❌ | ✅ | ✅ |
| Transparent overlays | ❌ | ❌ | ✅ | ✅ |
| Overlay style selection | ❌ | ❌ | ✅ | ✅ |
| No info panel | ❌ | ❌ | ✅ | ✅ |

---

## Enterprise Edition Features

### Overlay Themes

1. **✨ Gold Premium**
   - Gold borders and glow
   - White text
   - Transparent interior
   - Premium/luxury branding

2. **⚪ White Elegant**
   - White borders and glow
   - White text
   - Transparent interior
   - Clean, minimal design

3. **🔵 Classic Cyan**
   - Cyan borders and glow
   - White text
   - Transparent interior
   - Original TikTok style

### Key Features

- **Overlay Style Selection**: Choose theme per group in dashboard
- **Transparent Design**: Perfect for OBS chroma key
- **No Distractions**: Clean counter without tooltips
- **Professional Look**: Premium design for enterprise streaming

---

## Version History

### v2.3.1 (Backend Integration V2)
- Fixed infinite reconnection loops
- Limited reconnection attempts to 5
- Auto-disconnect on stream end
- Permanent stop flag after max attempts

### Enterprise v1.0
- Three overlay themes
- Dynamic theme system
- Overlay style selection
- Transparent backgrounds
- Removed info panel

---

## Support

For branch-specific issues:
- **General bugs**: Create issue on main branch
- **Enterprise features**: Tag with `enterprise-edition`
- **Customer-specific**: Use customer branch name in issue title

---

Last Updated: 2025-10-28
