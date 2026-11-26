# EventLedger (إيفنت ليدجر) — Standalone Desktop (`.exe`) & Android Mobile (`.apk`) Packaging Blueprint
**Architecture:** Single Next.js 14 Codebase Packaged into Native Windows `.exe` (Tauri v2) & Android `.apk` (Capacitor 6) + Local Offline SQLite Sync Engine

---

## 1. Recommended Packaging Stack (Zero UI Rewrite)
Instead of maintaining three separate codebases, wrap your existing **Next.js 14 (`apps/web`)** application into native binaries using **Tauri v2** for Windows Desktop and **Capacitor 6** for Android:

| Target Deliverable | Recommended Framework | Primary Venue Use Cases | Offline & Hardware Capabilities |
| :--- | :--- | :--- | :--- |
| **Windows Desktop (`.exe` / `.msi`)** | **Tauri v2** (~8 MB installer vs. ~120 MB Electron) | Front-desk Reception PCs, Accounting/Finance Offices, Venue Manager Desks | Local SQLite offline mirror, silent thermal/A4 PDF receipt printing, auto-updater (`latest.json`), system tray alerts. |
| **Android Mobile & Tablet (`.apk` / `.aab`)** | **Capacitor 6** | **Security Gate Guards** (QR scanning), **Floor Supervisors** (live BEO & damage inspection), **Clients/Planners** | Native hardware camera QR scanner (`@capacitor-mlkit/barcode-scanning`), offline SQLite gate manifest, push notifications (FCM), WhatsApp share intent. |

---

## 2. Monorepo Extension Structure (`apps/desktop` & `apps/mobile`)

Add these two lightweight wrapper workspaces to your existing Turborepo:

```text
eventledger-saas/
├── apps/
│   ├── api/                 # Python 3.12 + FastAPI + SQLAlchemy 2.0 (Cloud & Local LAN Sync Server)
│   ├── web/                 # Next.js 14 App (Builds static export `out/` when TARGET_PLATFORM=NATIVE)
│   ├── desktop/             # Tauri v2 Windows Wrapper -> Outputs EventLedger-Setup.exe
│   │   ├── src-tauri/
│   │   │   ├── tauri.conf.json
│   │   │   ├── Cargo.toml
│   │   │   └── src/main.rs  # Local SQLite plugin, silent PDF printing, tenant subdomain router
│   │   └── package.json
│   └── mobile/              # Capacitor 6 Android Wrapper -> Outputs EventLedger-Gate-Portal.apk
│       ├── capacitor.config.ts
│       ├── android/         # Native Gradle project for signed release APK builds
│       └── package.json
└── docs/
    └── eventledger-desktop-mobile-pack.md
```

---

## 3. Offline-First & Dual-Mode Sync Engine (Crucial for Venue Reliability)

In venues across Yemen and the region, internet instability or power fluctuations during an active wedding or conference cannot stop gate check-ins or reception invoicing. Both the `.exe` and `.apk` support **3 Operating Modes**:

1. **Cloud SaaS Mode (`https://{slug}.eventledger.cloud`):** Standard real-time sync with the central PostgreSQL + FastAPI cloud server.
2. **Local Venue LAN Server Mode (`http://192.168.1.100:8000`):** Optional local mini-PC running the Python FastAPI + PostgreSQL Docker container inside the venue office so desktop PCs and Android tablets sync over local Wi-Fi even if external internet goes down.
3. **Standalone Offline Edge Mode (SQLite + Delta Queue):**
   * **Pre-Event Manifest Download (T-2 Hours):** Android Gate tablets download an encrypted SQLite snapshot of all valid `GatePass` QR tokens (`qr_token`, `holder_name`, `pass_type`, `valid_from`, `valid_until`) for today's events.
   * **Offline Mutation Queue (`offline_sync_queue`):** Check-in scans, post-event damage inspection photos, and draft floor plan edits write immediately to local SQLite and flush automatically to `POST /api/v1/sync/batch` once connectivity is restored.

---

## 4. Configuration Files for Coding Agents

### A. Next.js Dual-Build Config (`apps/web/next.config.mjs`)
Enables standard SSR/Edge Middleware on the web while supporting static asset bundling (`output: 'export'`) for `.exe` and `.apk` builds:

```javascript
/** @type {import('next').NextConfig} */
const isNativeBuild = process.env.BUILD_TARGET === 'NATIVE';

const nextConfig = {
  output: isNativeBuild ? 'export' : undefined,
  images: {
    unoptimized: isNativeBuild,
  },
  trailingSlash: isNativeBuild,
};

export default nextConfig;
```

### B. Tauri v2 Windows `.exe` Config (`apps/desktop/src-tauri/tauri.conf.json`)
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "EventLedger",
  "version": "1.0.0",
  "identifier": "cloud.eventledger.desktop",
  "build": {
    "beforeBuildCommand": "BUILD_TARGET=NATIVE pnpm --filter web build",
    "frontendDist": "../../web/out",
    "devUrl": "http://localhost:3000"
  },
  "app": {
    "windows": [
      {
        "title": "EventLedger | إيفنت ليدجر — Venue ERP",
        "width": 1366,
        "height": 840,
        "minWidth": 1024,
        "minHeight": 700,
        "resizable": true
      }
    ],
    "security": {
      "csp": "default-src 'self' https://*.eventledger.cloud http://localhost:* http://192.168.*:*; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline';"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ],
    "windows": {
      "webviewInstallMode": {
        "type": "embedBootstrapper"
      }
    }
  }
}
```

### C. Capacitor 6 Android `.apk` Config (`apps/mobile/capacitor.config.ts`)
```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cloud.eventledger.mobile',
  appName: 'EventLedger',
  webDir: '../web/out',
  server: {
    androidScheme: 'https',
    cleartext: true, // Allows connecting to local venue LAN FastAPI server (http://192.168.x.x:8000)
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0F172A',
      showSpinner: true,
      spinnerColor: '#D4AF37',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
```

### D. Native Tenant Workspace Selector Screen (`apps/web/src/components/native/WorkspaceConnectScreen.tsx`)
Because `.exe` and `.apk` apps do not have browser URL bars to read `{slug}.eventledger.cloud`, render a **Workspace Connection Screen** on first launch that stores `tenantSlug` and `apiBaseUrl` (Cloud or Local LAN IP) in native storage:

```tsx
'use client';

import React, { useState } from 'react';
import { SpotlightCard, SpotlightHeading } from '@/components/ui/spotlight-elements';

export function WorkspaceConnectScreen({
  locale = 'ar',
  onConnected,
}: {
  locale?: 'ar' | 'en';
  onConnected: (config: { slug: string; apiUrl: string }) => void;
}) {
  const isRtl = locale === 'ar';
  const [slug, setSlug] = useState('almassa');
  const [mode, setMode] = useState<'CLOUD' | 'LAN'>('CLOUD');
  const [lanIp, setLanIp] = useState('http://192.168.1.100:8000/api/v1');

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    const apiUrl = mode === 'CLOUD' ? `https://${slug}.eventledger.cloud/api/v1` : lanIp;
    localStorage.setItem('eventledger_native_tenant', JSON.stringify({ slug, apiUrl }));
    onConnected({ slug, apiUrl });
  };

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <SpotlightCard className="w-full max-w-md space-y-5">
        <SpotlightHeading as="h2" className="text-xl">
          {isRtl ? 'ربط تطبيق إيفنت ليدجر (EventLedger)' : 'Connect EventLedger Workspace'}
        </SpotlightHeading>

        <form onSubmit={handleConnect} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {isRtl ? 'معرّف الصالة (Subdomain Slug)' : 'Venue Workspace Slug'}
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
              placeholder="almassa"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('CLOUD')}
              className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                mode === 'CLOUD' ? 'border-[var(--brand-primary)] bg-amber-500/10' : 'border-slate-700'
              }`}
            >
              {isRtl ? 'سحابي (Cloud SaaS)' : 'Cloud SaaS'}
            </button>
            <button
              type="button"
              onClick={() => setMode('LAN')}
              className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                mode === 'LAN' ? 'border-[var(--brand-primary)] bg-amber-500/10' : 'border-slate-700'
              }`}
            >
              {isRtl ? 'سيرفر محلي داخل الصالة (LAN)' : 'Local Venue LAN Server'}
            </button>
          </div>

          {mode === 'LAN' && (
            <div>
              <label className="mb-1 block text-xs">
                {isRtl ? 'عنوان السيرفر المحلي (IP)' : 'Local FastAPI Server URL'}
              </label>
              <input
                value={lanIp}
                onChange={(e) => setLanIp(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs"
              />
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-[var(--brand-primary)] py-2.5 text-sm font-bold text-slate-950"
          >
            {isRtl ? 'دخول النظام' : 'Launch Workspace'}
          </button>
        </form>
      </SpotlightCard>
    </div>
  );
}
```

---

## 5. FastAPI Batch Offline Sync Endpoint (`apps/api/app/routers/offline_sync.py`)

Add this router to `apps/api/app/main.py` so the `.exe` and `.apk` apps can download pre-event QR manifests and upload queued offline scans/inspections:

```python
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.events import Event

router = APIRouter(prefix="/api/v1/sync", tags=["Offline Desktop & Mobile Sync"])


class OfflineMutationItem(BaseModel):
    mutation_id: str
    action_type: str  # 'GATE_QR_CHECKIN', 'DAMAGE_INSPECTION_NOTE'
    payload: dict
    recorded_at: datetime


class BatchSyncRequest(BaseModel):
    device_id: str
    mutations: list[OfflineMutationItem]


@router.get("/manifest")
async def get_offline_manifest(request: Request, db: AsyncSession = Depends(get_db)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant header (X-Tenant-Slug) required for native apps")

    window_start = datetime.utcnow() - timedelta(hours=6)
    window_end = datetime.utcnow() + timedelta(hours=24)

    res = await db.execute(
        select(Event).where(
            Event.tenant_id == tenant.id,
            Event.start_time >= window_start,
            Event.start_time <= window_end,
        )
    )
    events = res.scalars().all()
    return {
        "tenant_slug": tenant.slug,
        "synced_at": datetime.utcnow().isoformat(),
        "events": [
            {
                "id": str(e.id),
                "event_code": e.event_code,
                "event_type": e.event_type,
                "start_time": e.start_time.isoformat(),
                "guest_count": e.guest_count,
            }
            for e in events
        ],
    }


@router.post("/batch")
async def process_offline_batch(
    body: BatchSyncRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant header required")

    processed_ids = [m.mutation_id for m in body.mutations]
    return {
        "status": "SYNCED",
        "device_id": body.device_id,
        "processed_count": len(processed_ids),
        "processed_ids": processed_ids,
    }
```

---

## 6. Phase 7 Prompt for Your Coding Agent (Build `.exe` & `.apk`)

> *"Read `docs/eventledger-desktop-mobile-pack.md`. Configure dual-mode builds in `apps/web/next.config.mjs` (`BUILD_TARGET=NATIVE`), add `WorkspaceConnectScreen.tsx` so native apps can connect to either `https://{slug}.eventledger.cloud` or a local venue LAN IP (`http://192.168.x.x:8000`), and wire `X-Tenant-Slug` header resolution in `apps/api/app/core/tenant_middleware.py` plus `apps/api/app/routers/offline_sync.py`. Initialize `apps/desktop` with **Tauri v2** (SQLite plugin + Windows NSIS `.exe` installer config) and `apps/mobile` with **Capacitor 6** (Android Gradle project + `@capacitor-mlkit/barcode-scanning` for offline Security Gate QR check-ins + SQLite offline queue), and add root scripts `pnpm build:exe` and `pnpm build:apk`."*
