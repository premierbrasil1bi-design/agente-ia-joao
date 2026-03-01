import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import styles from "./AdminLayout.module.css";

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  tenants: "Tenants",
  plans: "Planos",
  usage: "Uso",
  billing: "Billing",
  logs: "Logs",
  admins: "Admins",
  settings: "Configurações",
  new: "Novo",
};

function getBreadcrumb(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return ["Dashboard"];
  const first = parts[0];
  const labels = [ROUTE_LABELS[first] ?? first];
  if (parts[1] === "new") labels.push("Novo");
  else if (parts[1] && !["new"].includes(parts[1])) labels.push(parts[1]);
  return labels;
}

export default function AdminLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const breadcrumb = getBreadcrumb(location.pathname);

  return (
    <div className={styles.wrapper}>
      <Sidebar collapsed={sidebarCollapsed} />
      <div className={styles.main}>
        <Topbar breadcrumb={breadcrumb} onMenuClick={() => setSidebarCollapsed((c) => !c)} />
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
