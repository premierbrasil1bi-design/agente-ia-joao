import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import ProtectedGlobalAdminRoute from "./auth/ProtectedGlobalAdminRoute";
import Layout from "./components/Layout";
import GlobalAdminLogin from "./pages/GlobalAdminLogin";
import GlobalAdminDashboard from "./pages/GlobalAdminDashboard";
import Tenants from "./pages/Tenants";
import TenantNew from "./pages/TenantNew";
import TenantDetail from "./pages/TenantDetail";
import TenantUsers from "./pages/TenantUsers";
import Plans from "./pages/Plans";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<GlobalAdminLogin />} />
          <Route path="/dashboard" element={<ProtectedGlobalAdminRoute><GlobalAdminDashboard /></ProtectedGlobalAdminRoute>} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/tenants/new" element={<TenantNew />} />
            <Route path="/tenants/:id" element={<TenantDetail />} />
            <Route path="/tenants/:id/users" element={<TenantUsers />} />
            <Route path="/plans" element={<Plans />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
