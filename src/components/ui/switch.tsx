import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

/* DESIGN.md v3.1 §4.6/§7.4 — a 40×24 visual track inside a 40×36
   hit target. Radix supplies keyboard and role=switch semantics. */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group relative flex h-9 w-10 shrink-0 items-center rounded-full",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 h-6 rounded-full border border-subtle bg-raised transition-colors duration-fast ease-fast group-data-[state=checked]:border-accent group-data-[state=checked]:bg-accent"
      />
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none relative z-base ml-0.5 block h-5 w-5 rounded-full bg-white shadow-elev-1",
          "transition-[translate] duration-fast ease-fast",
          "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
