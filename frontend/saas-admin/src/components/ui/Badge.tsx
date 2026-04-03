import { type ReactNode } from "react";
import styles from "./Badge.module.css";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "purple";

type BadgeProps = {
  variant?: Variant;
  children: ReactNode;
  className?: string;
};

export function Badge({ variant = "default", children, className = "" }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]} ${className}`}>{children}</span>;
}
