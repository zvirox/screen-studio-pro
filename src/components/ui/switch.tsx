import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/cn";

/* DESIGN.md v5.0 — flat Linear switch (6px track, 4px thumb, blue primary when checked, no pill/dark shadow). */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group relative flex h-9 w-10 shrink-0 items-center rounded-sm",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 h-5 rounded-sm border border-subtle bg-solid transition-colors duration-fast ease-fast group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary"
      />
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none relative z-base ml-0.5 block h-4 w-4 rounded-xs bg-[var(--text-muted)] transition-[translate,background-color] duration-fast ease-fast data-[state=checked]:bg-white",
          "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
