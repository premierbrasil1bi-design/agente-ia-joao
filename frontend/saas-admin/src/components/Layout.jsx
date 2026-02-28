import "../App.css";
import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  function handleLogout() {
    logout();
    navigate("/login");
  }
  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>SaaS Admin</h2>
        <nav>
          <Link to="/tenants">Tenants</Link>
          <Link to="/plans">Plans</Link>
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <span>{user?.email}</span>
          <button onClick={handleLogout}>Logout</button>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
