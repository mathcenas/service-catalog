import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AccessPage } from './pages/AccessPage';

const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const SharePage = lazy(() => import('./pages/SharePage').then(m => ({ default: m.SharePage })));
const AclReviewPage = lazy(() => import('./pages/AclReviewPage').then(m => ({ default: m.AclReviewPage })));
const EmailAuditPage = lazy(() => import('./pages/EmailAuditPage').then(m => ({ default: m.EmailAuditPage })));
const ContactPage = lazy(() => import('./pages/ContactPage').then(m => ({ default: m.ContactPage })));
const PreferencesPage = lazy(() => import('./pages/PreferencesPage').then(m => ({ default: m.PreferencesPage })));

function AppContent() {
  const { user, loading } = useAuth();

  const path = window.location.pathname;
  const shareMatch      = path.match(/^\/share\/([a-z0-9-]+)$/i);
  const aclReviewMatch  = path.match(/^\/acl-review\/([a-z0-9]+)$/i);
  const emailAuditMatch = path.match(/^\/email-audit\/([a-z0-9]+)$/i);
  const isAccessPage      = path === '/acceso';
  const isContactPage     = path === '/contacto';
  const isPreferencesPage = path === '/preferencias';

  if (isAccessPage)      return <AccessPage />;
  if (isContactPage)     return <ContactPage />;
  if (isPreferencesPage) return <PreferencesPage />;

  if (shareMatch) {
    return <SharePage token={shareMatch[1]} />;
  }

  if (aclReviewMatch) {
    return <AclReviewPage token={aclReviewMatch[1]} />;
  }

  if (emailAuditMatch) {
    return <EmailAuditPage token={emailAuditMatch[1]} />;
  }

  // Unknown public paths (not a known route pattern) → branded 404
  const isKnownPath = path === '/' || shareMatch || aclReviewMatch || emailAuditMatch || isAccessPage || isContactPage || isPreferencesPage;
  if (!isKnownPath && !loading && !user) {
    return (
      <div className="min-h-screen bg-[#0B192C] flex flex-col items-center justify-center px-4 text-center">
        <div className="mb-6">
          <div className="inline-flex items-center bg-[#1E293B] px-4 py-2 rounded-lg mb-8">
            <span className="text-[#06B6D4] font-bold text-sm tracking-widest">CENAS IT</span>
          </div>
          <h1 className="text-5xl font-bold text-white mb-3">404</h1>
          <p className="text-slate-400 text-base">Esta página no existe o el enlace es inválido.</p>
          <p className="text-slate-500 text-sm mt-2">Si recibiste un enlace por correo, verificá que esté completo.</p>
        </div>
        <p className="text-slate-600 text-xs mt-8">Cenas IT Solutions — cenas.uy</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#06B6D4]"></div>
      </div>
    );
  }

  return user ? <Dashboard /> : <AccessPage />;
}

function App() {
  return (
    <AuthProvider>
      <Suspense fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#06B6D4]"></div>
        </div>
      }>
        <AppContent />
      </Suspense>
    </AuthProvider>
  );
}

export default App;
