import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/* DESIGN.md v3.1 §4.6 m.reveal — opacity 0→1 + translateY(6px→0) on
   m.base when a section enters the viewport. The global reduced-motion
   rule and motion-reduce:translate-none keep this opacity-only for users
   who ask for less motion. jsdom has no IntersectionObserver, so tests
   render the revealed state immediately. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,translate] duration-base ease-fast motion-reduce:translate-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
