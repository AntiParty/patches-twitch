# FinalsRR Custom Hosted Overlays — Full Implementation Plan

Allow streamers to display real-time **THE FINALS** stats on their streams using browser-source overlays in OBS/Streamlabs.

---

## 🚨 User Review Required (Critical Decisions)

### **1. Authentication Approach**
Overlays will use **unique access tokens per user** to fetch data.  
Users generate tokens from a dashboard.  
Prevents unauthorized access while keeping overlays simple.

### **2. Update Mechanism**
Initial implementation: **Polling every 30–60 seconds**.  
Later: Optional **WebSocket real-time updates**.

### **3. Customization Scope**
Start with **3–5 pre-designed themes**.  
Advanced customization (custom CSS) in future iterations.

---

# 📌 Proposed Changes

## Backend — API Endpoints

### **[NEW] overlay-routes.js**
Add endpoints:

- `GET /api/overlay/:username/token`  
  Generate or retrieve overlay access token (authenticated)

- `GET /api/overlay/data/:token`  
  Fetch overlay data using token (**public, rate-limited**)

- `GET /api/overlay/config/:token`  
  Get user's overlay configuration

- `POST /api/overlay/config/:token`  
  Update overlay configuration (theme, colors, layout)

**Returned Data Example:**
```json
{
  "username": "PlayerName#1234",
  "rank": 948,
  "league": "Diamond 1",
  "rankScore": 48234,
  "wtRank": 523,
  "goal": {
    "targetRank": 100,
    "progress": 15.3,
    "remaining": 18234
  },
  "session": {
    "startRS": 45893,
    "currentRS": 48234,
    "change": 2341
  },
  "lastUpdated": "2025-11-25T08:26:44Z"
}