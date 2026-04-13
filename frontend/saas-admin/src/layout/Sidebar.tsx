import { Link, useLocation } from "react-router-dom";
import styles from "./Sidebar.module.css";

export type NavItem = { to: string; label: string; icon: string };

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "◉" },
  { to: "/tenants", label: "Tenants", icon: "▣" },
  { to: "/tenant-users", label: "Usuários de Clientes", icon: "👥" },
  { to: "/plans", label: "Planos", icon: "◇" },
  { to: "/usage", label: "Uso", icon: "▤" },
  { to: "/billing", label: "Billing", icon: "◎" },
  { to: "/logs", label: "Logs", icon: "≡" },
  { to: "/admin/providers", label: "Providers", icon: "🩺" },
  { to: "/socket-metrics", label: "Socket Metrics", icon: "📈" },
  { to: "/incident-timeline", label: "Incident Timeline", icon: "🚨" },
  { to: "/session-operations", label: "Session Ops", icon: "🛰" },
  { to: "/admins", label: "Admins", icon: "👤" },
  { to: "/settings", label: "Configurações", icon: "⚙" },
];

type SidebarProps = { collapsed: boolean };

export default function Sidebar({ collapsed }: SidebarProps) {
  const location = useLocation();

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      <div className={styles.brand}>
        <span className={styles.logo}>OMNIA</span>
        {!collapsed && <span className={styles.sublogo}>Admin</span>}
      </div>
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.to || (item.to !== "/dashboard" && location.pathname.startsWith(item.to));
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`${styles.link} ${isActive ? styles.active : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className={styles.icon}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
