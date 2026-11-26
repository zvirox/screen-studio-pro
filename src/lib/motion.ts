/* JS mirror of DESIGN.md v6.0 motion tokens (150ms ease-out).
   framer-motion cannot read CSS custom properties in transition props,
   so the numbers live here. Reduced-motion is handled once by
   <MotionConfig reducedMotion="user"> at each webview root. */

export const MOTION = {
  fast: 0.15,
  base: 0.15,
  slow: 0.15,
  settle: 0.09,
  easeBase: [0, 0, 0.2, 1] as const,
  revealY: 4,
} as const;
