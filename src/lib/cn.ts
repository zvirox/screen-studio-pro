import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/* The shadcn-style class combiner (clsx + tailwind-merge, both already
   project deps). Token classes only — a computed literal in a component
   is a review failure (DESIGN §8). */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
