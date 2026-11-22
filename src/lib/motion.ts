/* JS mirror of DESIGN.md v3.1 §4.6's motion tokens — framer-motion
   cannot read CSS custom properties in transition props, so the numbers
   live here and carry the contract reference. Reduced-motion is handled
   once by <MotionConfig reducedMotion="user"> at each webview root. */

export const MOTION = {
  fast: 0.14,
  base: 0.18,
  slow: 0.24,
  settle: 0.09,
  easeBase: [0.34, 1.56, 0.64, 1] as const,
  revealY: 6,
} as const;
