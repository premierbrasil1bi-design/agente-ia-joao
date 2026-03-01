import { type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  return (
    <button type="button" className={`${styles.btn} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
