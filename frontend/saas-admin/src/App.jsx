import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
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
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/tenants/new" element={<TenantNew />} />
            <Route path="/tenants/:id" element={<TenantDetail />} />
            <Route path="/tenants/:id/users" element={<TenantUsers />} />
            <Route path="/plans" element={<Plans />} />
          </Route>
          <Route path="*" element={<Login />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
