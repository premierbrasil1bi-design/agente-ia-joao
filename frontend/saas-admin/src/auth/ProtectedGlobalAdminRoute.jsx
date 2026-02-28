import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * Protege rotas que exigem Global Admin autenticado.
 * Redireciona para /login se não houver token.
 */
export default function ProtectedGlobalAdminRoute({ children }) {
  const { getToken } = useAuth();
  const location = useLocation();
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
