import { type ReactNode } from "react";
import styles from "./Table.module.css";

type TableProps = {
  children: ReactNode;
  className?: string;
};

export function Table({ children, className = "" }: TableProps) {
  return (
    <div className={styles.wrapper}>
      <table className={`${styles.table} ${className}`}>{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className={styles.thead}>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className={styles.tbody}>{children}</tbody>;
}

export function TableRow({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr className={onClick ? styles.rowClickable : undefined} onClick={onClick}>
      {children}
    </tr>
  );
}
