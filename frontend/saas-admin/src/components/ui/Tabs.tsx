import { type ReactNode } from "react";
import styles from "./Tabs.module.css";

type Tab = { id: string; label: string };

type TabsProps = {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
  children?: ReactNode;
};

export function Tabs({ tabs, activeId, onChange, children }: TabsProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.list} role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeId === tab.id}
            className={`${styles.tab} ${activeId === tab.id ? styles.active : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children && <div className={styles.panel}>{children}</div>}
    </div>
  );
}
