import type { ReactNode } from "react";

export function PrivateValue({ children, sensitive = true }: { children: ReactNode; sensitive?: boolean }) {
  return sensitive ? <span className="private-value inline-block">{children}</span> : <>{children}</>;
}
