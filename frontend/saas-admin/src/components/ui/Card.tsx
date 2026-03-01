import { type ReactNode } from "react";
import styles from "./Card.module.css";

type CardProps = {
  children: ReactNode;
  title?: string;
  className?: string;
};

export function Card({ children, title, className = "" }: CardProps) {
  return (
    <div className={`${styles.card} ${className}`}>
      {title && <h3 className={styles.title}>{title}</h3>}
      {children}
    </div>
  );
}
