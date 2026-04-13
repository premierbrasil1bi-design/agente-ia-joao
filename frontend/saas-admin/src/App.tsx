import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import AdminLayout from "./layout/AdminLayout";
import Login from "./pages/Login";
import DashboardPage from "./pages/DashboardPage";
import TenantsListPage from "./pages/TenantsListPage";
import TenantDetailPage from "./pages/TenantDetailPage";
import TenantNew from "./pages/TenantNew";
import TenantUsers from "./pages/TenantUsers";
import TenantUsersList from "./pages/TenantUsersList";
import PlansPage from "./pages/PlansPage";
import UsagePage from "./pages/UsagePage";
import BillingPage from "./pages/BillingPage";
import LogsPage from "./pages/LogsPage";
import AdminsPage from "./pages/AdminsPage";
import SettingsPage from "./pages/SettingsPage";
import SocketMetricsPage from "./pages/SocketMetricsPage";
import IncidentTimelinePage from "./pages/IncidentTimelinePage";
import ProvidersPage from "./pages/providers/ProvidersPage";
import SessionOperationsPage from "./pages/SessionOperationsPage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/tenants" element={<TenantsListPage />} />
            <Route path="/tenants/new" element={<TenantNew />} />
            <Route path="/tenants/:tenantId" element={<TenantDetailPage />} />
            <Route path="/tenants/:id/users" element={<TenantUsers />} />
            <Route path="/tenant-users" element={<TenantUsersList />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/socket-metrics" element={<SocketMetricsPage />} />
            <Route path="/admin/providers" element={<ProvidersPage />} />
            <Route path="/incident-timeline" element={<IncidentTimelinePage />} />
            <Route path="/session-operations" element={<SessionOperationsPage />} />
            <Route path="/admins" element={<AdminsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
