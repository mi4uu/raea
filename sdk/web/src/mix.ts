// raea/mix in a browser page: the loudness pass is raea's native mix; in a page the buses' fixed lift and limiter
// stand in for it (tone.ts). export-three.ts maps `raea/mix` here.
import type { ReactNode } from "react";

export interface MixProps {
  lufs?: number;
  ceiling?: number;
  children?: ReactNode;
}

export function Mix({ children }: MixProps): ReactNode {
  return children ?? null;
}
