import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';

const LandingPage = lazy(() => import('../pages/LandingPage'));
const AuthPage = lazy(() => import('../pages/AuthPage'));
const ExtensionAuthPage = lazy(() => import('../pages/ExtensionAuthPage'));
const GuidePage = lazy(() => import('../pages/GuidePage'));
const AdminGate = lazy(() => import('../admin/AdminGate'));
const AdminShell = lazy(() => import('../admin/AdminShell'));
const AdminOverviewPage = lazy(() => import('../pages/admin/OverviewPage'));
const AdminPlatformPage = lazy(() => import('../pages/admin/PlatformPage'));
const AdminUsersPage = lazy(() => import('../pages/admin/UsersPage'));
const AdminEntitlementsPage = lazy(
  () => import('../pages/admin/EntitlementsPage'),
);
const AdminAuditPage = lazy(() => import('../pages/admin/AuditPage'));
const AdminGuidesPage = lazy(() => import('../pages/admin/GuidesPage'));
const AdminGuideEditorPage = lazy(
  () => import('../pages/admin/GuideEditorPage'),
);

const routeFallback = <div className="route-fallback" aria-hidden="true" />;

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={routeFallback}>
        <LandingPage />
      </Suspense>
    ),
  },
  {
    path: '/auth',
    element: (
      <Suspense fallback={routeFallback}>
        <AuthPage />
      </Suspense>
    ),
  },
  {
    path: '/auth/extension/:flowId',
    element: (
      <Suspense fallback={routeFallback}>
        <ExtensionAuthPage />
      </Suspense>
    ),
  },
  {
    path: '/guide/:slug',
    element: (
      <Suspense fallback={routeFallback}>
        <GuidePage />
      </Suspense>
    ),
  },
  {
    path: '/admin',
    element: (
      <Suspense fallback={routeFallback}>
        <AdminGate />
      </Suspense>
    ),
    children: [
      {
        element: (
          <Suspense fallback={routeFallback}>
            <AdminShell />
          </Suspense>
        ),
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={routeFallback}>
                <AdminOverviewPage />
              </Suspense>
            ),
          },
          {
            path: 'platform',
            element: (
              <Suspense fallback={routeFallback}>
                <AdminPlatformPage />
              </Suspense>
            ),
          },
          {
            path: 'users',
            element: (
              <Suspense fallback={routeFallback}>
                <AdminUsersPage />
              </Suspense>
            ),
          },
          {
            path: 'entitlements',
            element: (
              <Suspense fallback={routeFallback}>
                <AdminEntitlementsPage />
              </Suspense>
            ),
          },
          {
            path: 'audit',
            element: (
              <Suspense fallback={routeFallback}>
                <AdminAuditPage />
              </Suspense>
            ),
          },
          {
            path: 'guides',
            element: (
              <Suspense fallback={routeFallback}>
                <AdminGuidesPage />
              </Suspense>
            ),
          },
          {
            path: 'guides/new',
            element: (
              <Suspense fallback={routeFallback}>
                <AdminGuideEditorPage create />
              </Suspense>
            ),
          },
          {
            path: 'guides/:slug/edit',
            element: (
              <Suspense fallback={routeFallback}>
                <AdminGuideEditorPage />
              </Suspense>
            ),
          },
        ],
      },
    ],
  },
]);
