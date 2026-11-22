import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/* DESIGN.md v3.1 §4.6/§5.1/§7.4 — shared tactile control geometry.
   These styles consolidate the existing input/button recipes rather than
   introducing a second visual system. */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border font-medium text-body-sm outline-none transition-[color,background-color,border-color,box-shadow,scale] duration-fast ease-fast focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:scale-none disabled:cursor-not-allowed disabled:opacity-50 enabled:active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "border-accent bg-accent text-accent-text hover:bg-accent-hover focus-visible:ring-focus",
        secondary:
          "border-subtle bg-solid text-ink hover:border-accent hover:bg-surface-hover focus-visible:ring-focus",
        ghost:
          "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:ring-focus",
        danger: "border-error bg-error text-white hover:brightness-110 focus-visible:ring-error",
      },
      size: {
        sm: "min-h-9 px-3",
        md: "min-h-10 px-4",
        lg: "min-h-12 px-5",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export default function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
