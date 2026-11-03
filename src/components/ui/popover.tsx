import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../lib/cn";

/* DESIGN §5.3 Popover — glass recipe (`glass-strong` modal ground) on
   `elev.2`, `r.sm`, max-height 320px. Radix supplies the keyboard law
   (§7.3): Esc closes, focus returns to the trigger, tab stays inside.
   Content/Anchor re-exported so callers compose without importing the
   primitive directly (the only allowed Radix surface besides switch). */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          /* §5.3: Popover = the Modal glass recipe on elev.2, r.sm,
             max-height 320px (the `modal` utility carries fill/blur/
             border/elev-2 verbatim — Tailwind v4 token: max-h-80). */
          "modal z-50 max-h-80 overflow-y-auto rounded-sm p-2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
