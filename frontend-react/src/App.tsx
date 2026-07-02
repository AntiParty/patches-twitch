/*
 * Root router. Layout shells wrap their routes. All pages are migrated;
 * chart-heavy routes (Statistics, Admin Overview/Health) are lazy-loaded.
 */
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Spinner } from '@/components/feedback/Spinner'
import { AppLayout } from '@/layouts/AppLayout'
import { DashboardLayout } from '@/layouts/DashboardLayout'
import { AdminLayout } from '@/layouts/AdminLayout'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { Landing } from '@/features/landing/Landing'
import { NotFound } from '@/pages/NotFound'
import { Overview } from '@/features/dashboard/Overview'
import { Commands } from '@/features/dashboard/Commands'
import { Settings } from '@/features/dashboard/Settings'
import { RankTracker } from '@/features/dashboard/RankTracker'
import { Overlays } from '@/features/dashboard/Overlays'
import { Predictions } from '@/features/dashboard/Predictions'
import { CustomBot } from '@/features/dashboard/CustomBot'
import { Leaderboard } from '@/features/leaderboard/Leaderboard'
import { Subscribe } from '@/features/subscribe/Subscribe'
import { Docs } from '@/features/docs/Docs'
import { Developer } from '@/features/developer/Developer'
import { Legal } from '@/features/legal/Legal'
import { Drops as TwitchDrops } from '@/features/drops/Drops'
import { Banned } from '@/pages/Banned'
import { SystemMessage } from '@/pages/SystemMessage'
import { Overlay } from '@/features/overlays/Overlay'
import { Users as AdminUsers } from '@/features/admin/Users'
import { Channels as AdminChannels } from '@/features/admin/Channels'
import { Audit as AdminAudit } from '@/features/admin/Audit'
import { MessageBot as AdminMessageBot } from '@/features/admin/MessageBot'
import { Drops as AdminDrops } from '@/features/admin/Drops'
// Statistics pulls in Recharts (~heavy) — lazy-load so it stays out of the main bundle.
const Statistics = lazy(() =>
  import('@/features/statistics/Statistics').then((m) => ({ default: m.Statistics })),
)
// Admin Overview/Health pull in Recharts — lazy-load to keep it out of the main bundle.
const AdminOverview = lazy(() =>
  import('@/features/admin/Overview').then((m) => ({ default: m.Overview })),
)
const AdminHealth = lazy(() =>
  import('@/features/admin/Health').then((m) => ({ default: m.Health })),
)

export default function App() {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
            <Spinner />
          </div>
        }
      >
      <Routes>
        {/* Internal analyst dashboard (own 403 access handling) */}
        <Route path="/statistics" element={<Statistics />} />

        {/* OBS overlay (transparent, no chrome). Legacy /overlays/*.html stays on backend. */}
        <Route path="/overlay/:theme" element={<Overlay />} />

        {/* Standalone full-page message screens */}
        <Route path="/banned" element={<Banned />} />
        <Route path="/system-message" element={<SystemMessage />} />

        {/* Public / marketing pages share the AppLayout shell */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/developer" element={<Developer />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/twitch-drops" element={<TwitchDrops />} />
          <Route path="/drops" element={<Navigate to="/twitch-drops" replace />} />
        </Route>

        {/* Auth-gated pages that still use the public shell */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/subscribe" element={<Subscribe />} />
        </Route>

        {/* Authenticated dashboard */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Overview />} />
          <Route path="commands" element={<Commands />} />
          <Route path="predictions" element={<Predictions />} />
          <Route path="rank-tracker" element={<RankTracker />} />
          <Route path="overlays" element={<Overlays />} />
          <Route path="settings" element={<Settings />} />
          <Route path="subscription" element={<CustomBot />} />
        </Route>

        {/* Admin */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="health" element={<AdminHealth />} />
          <Route path="channels" element={<AdminChannels />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="message" element={<AdminMessageBot />} />
          <Route path="drops" element={<AdminDrops />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
