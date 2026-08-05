import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { SharePage } from './pages/SharePage';
import { AclReviewPage } from './pages/AclReviewPage';

function AppContent() {
  const { user, loading } = useAuth();

  const path = window.location.pathname;
  const shareMatch = path.match(/^\/share\/([a-z0-9-]+)$/i);
  const aclReviewMatch = path.match(/^\/acl-review\/([a-z0-9]+)$/i);

  if (shareMatch) {
    return <SharePage token={shareMatch[1]} />;
  }

  if (aclReviewMatch) {
    return <AclReviewPage token={aclReviewMatch[1]} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  return user ? <Dashboard /> : <Auth />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
