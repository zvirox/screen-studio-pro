#!/usr/bin/env node
/**
 * Unified Linear-Style Design System Gate.
 * Enforces solid flat opaque surfaces, hairline 1px borders, zero blur,
 * zero translucency, zero glow, zero dark-mode shadows, zero macOS CSD dots,
 * zero pill shapes (except explicit dots/circular webcam), and zero raw hex
 * colors outside src/tailwind.css.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI_SRC = join(APP_ROOT, "src");

function findFiles(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "test") continue;
      findFiles(full, exts, acc);
    } else if (
      exts.some((ext) => entry.endsWith(ext)) &&
      !entry.includes(".test.") &&
      !entry.includes(".spec.")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

const files = findFiles(UI_SRC, [".tsx", ".ts", ".css"]);
const violations = [];

const BLUR_REGEX = /(?:-webkit-)?backdrop-filter\s*:[^;]*blur\(|backdrop-blur|filter\s*:[^;]*blur\(/i;
const TRANSLUCENCY_FN_REGEX = /\b(?:rgba|hsla)\s*\(/i;
const TW_OPACITY_REGEX =
  /\b(?:bg|text|border|ring|fill|stroke|outline)-[a-zA-Z0-9_[\]-]+\/\d{1,3}\b/g;
const GLOW_REGEX = /\bdrop-shadow(?:\(|-[a-z])/i;
const DARK_SHADOW_CLASS_REGEX =
  /\bshadow-(?:xs|sm|md|lg|xl|2xl|elev-1|elev-2|elev-float|float)\b|shadow-\[/g;
const CSD_DOT_REGEX = /\bcsd-dot-(?:close|min|max)\b/;
const PILL_REGEX = /\brounded-full\b/;
const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}\b/g;

for (const file of files) {
  const rel = relative(APP_ROOT, file);
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const isTokenCss = rel === "src/tailwind.css";

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      return;
    }

    if (BLUR_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden blur rule`);
    }

    if (TRANSLUCENCY_FN_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden rgba()/hsla() translucency`);
    }

    const opacityMatches = line.match(TW_OPACITY_REGEX);
    if (opacityMatches) {
      violations.push(
        `${rel}:${lineNo} forbidden Tailwind opacity modifier (${opacityMatches.join(", ")})`,
      );
    }

    if (GLOW_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden glow / drop-shadow`);
    }

    if (!isTokenCss && DARK_SHADOW_CLASS_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden non-token / dark-mode shadow utility`);
    }

    if (CSD_DOT_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden macOS CSD traffic-light dot`);
    }

    if (PILL_REGEX.test(line) && !line.includes("linear-exception:")) {
      violations.push(
        `${rel}:${lineNo} forbidden rounded-full pill (use 4px/6px/8px rounding or mark status dot)`,
      );
    }

    if (!isTokenCss) {
      const hexMatches = line.match(HEX_COLOR_REGEX);
      if (hexMatches) {
        violations.push(
          `${rel}:${lineNo} raw hex color outside src/tailwind.css (${hexMatches.join(", ")})`,
        );
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `❌ check:linear gate FAILED (${violations.length} violation${violations.length === 1 ? "" : "s"}):`,
  );
  for (const v of violations.slice(0, 80)) {
    console.error(`  - ${v}`);
  }
  if (violations.length > 80) {
    console.error(`  ... and ${violations.length - 80} more.`);
  }
  process.exit(1);
}

console.log(
  "✅ check:linear gate PASSED: Solid matte Linear surfaces, zero blur/translucency/pills/raw-hex verified.",
);
