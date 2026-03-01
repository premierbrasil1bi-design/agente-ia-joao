import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useNavigate } from "react-router-dom";
import styles from "./Topbar.module.css";

type TopbarProps = {
  breadcrumb: string[];
  onMenuClick?: () => void;
};

export default function Topbar({ breadcrumb, onMenuClick }: TopbarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [userOpen, setUserOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/login");
    setUserOpen(false);
  };

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        {onMenuClick && (
          <button type="button" className={styles.menuBtn} onClick={onMenuClick} aria-label="Alternar menu">
            ☰
          </button>
        )}
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          {breadcrumb.map((item, i) => (
            <span key={i} className={styles.breadcrumbItem}>
              {i > 0 && <span className={styles.sep}>/</span>}
              {item}
            </span>
          ))}
        </nav>
      </div>
      <div className={styles.right}>
        <div className={styles.searchWrap}>
          <input
            type="search"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.search}
            aria-label="Busca"
          />
        </div>
        <div className={styles.userWrap}>
          <button
            type="button"
            className={styles.userBtn}
            onClick={() => setUserOpen((o) => !o)}
            aria-expanded={userOpen}
            aria-haspopup="true"
          >
            <span className={styles.userEmail}>{user?.email ?? "Admin"}</span>
            <span className={styles.chevron}>▼</span>
          </button>
          {userOpen && (
            <>
              <div className={styles.backdrop} onClick={() => setUserOpen(false)} aria-hidden="true" />
              <div className={styles.dropdown}>
                <div className={styles.dropdownEmail}>{user?.email}</div>
                <button type="button" className={styles.dropdownItem} onClick={handleLogout}>
                  Sair
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
