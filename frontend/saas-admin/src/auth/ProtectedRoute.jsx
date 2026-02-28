import { useAuth } from "../auth/AuthContext";
import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }) {
  const { getToken } = useAuth();
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}
