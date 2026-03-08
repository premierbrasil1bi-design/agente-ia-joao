import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * Protege rotas que exigem Global Admin autenticado.
 * Redireciona para /login só quando loading terminou e não há token.
 */
export default function ProtectedGlobalAdminRoute({ children }) {
  const { getToken, loading } = useAuth();
  const location = useLocation();
  const token = getToken();

  if (loading) return null;
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
