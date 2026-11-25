import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../lib/cn";

/* DESIGN.md v5.0 — solid Linear popover surface on 1px border, 8px radius, max-h-80. */
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
          "modal z-50 max-h-80 overflow-y-auto rounded-md p-1.5 text-ink",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
