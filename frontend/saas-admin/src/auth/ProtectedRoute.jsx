import { useAuth } from "../auth/AuthContext";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }) {
  const { getToken, loading } = useAuth();

  // Não redirecionar enquanto a sessão ainda está sendo verificada/restaurada
  if (loading) return null;
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}
