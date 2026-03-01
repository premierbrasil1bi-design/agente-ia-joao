import styles from "./Skeleton.module.css";

type SkeletonProps = {
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
};

export function Skeleton({ width, height = "1rem", className = "", style: styleProp }: SkeletonProps) {
  const style: React.CSSProperties = { ...styleProp };
  if (width) style.width = typeof width === "number" ? `${width}px` : width;
  if (height) style.height = typeof height === "number" ? `${height}px` : height;
  return <span className={`${styles.skeleton} ${className}`} style={style} aria-hidden />;
}
