#!/usr/bin/env node
/**
 * Linear-Style Design System Gate (Zero Frosted Glass).
 * Verifies that zero backdrop-filter: blur() exists in active UI components,
 * enforcing pure solid matte elevated surfaces.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI_SRC = join(APP_ROOT, "src");

function findFiles(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      findFiles(full, exts, acc);
    } else if (exts.some(ext => entry.endsWith(ext))) {
      acc.push(full);
    }
  }
  return acc;
}

const files = findFiles(UI_SRC, [".tsx", ".ts", ".css"]);
let violations = [];

const BLUR_REGEX = /(?:-webkit-)?backdrop-filter:\s*[^;]*blur\(/i;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (BLUR_REGEX.test(content)) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  console.error("❌ check:linear gate FAILED: backdrop-filter blur detected in solid Linear surfaces:");
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
} else {
  console.log("✅ check:linear gate PASSED: All surfaces adhere to zero-glass solid Linear specifications.");
  process.exit(0);
}
