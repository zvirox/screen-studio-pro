import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/* DESIGN.md v6.0 — shared flat tactile control geometry (6px radius, tokenized shadow). */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border font-medium text-body-sm outline-none transition-[color,background-color,border-color,scale] duration-fast ease-fast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:scale-none disabled:cursor-not-allowed disabled:opacity-50 enabled:active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "border-primary bg-primary text-primary-text hover:bg-primary-hover active:bg-primary-active",
        brand:
          "border-record-border bg-record text-record-text hover:bg-record active:bg-record",
        secondary:
          "border-subtle bg-solid text-ink hover:border-border-strong hover:bg-surface-hover",
        ghost:
          "border-transparent text-ink-secondary hover:bg-surface-hover hover:text-ink",
        danger:
          "border-error bg-tint-red text-error hover:bg-error hover:text-[var(--btn-primary-text)]",
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
