import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

/* DESIGN §5.4 Switch — 40×24 pill; on = `accent` track, off = `bg.raised`
   + `border.subtle`; knob white, `m.fast` translate. Radix supplies the
   keyboard + role=switch semantics (§7.3); the universal focus ring
   (§7.2) wraps the pill. Token references only (DESIGN §8). */

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full border border-subtle bg-raised",
        "transition-colors duration-fast ease-fast",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-elev-1",
          "transition-transform duration-fast ease-fast",
          "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
