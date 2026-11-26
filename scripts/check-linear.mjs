#!/usr/bin/env node
/**
 * Unified Linear-Style Design System Gate.
 * Enforces opaque surfaces, hairline borders, zero blur, restricted alpha/shadows,
 * zero glow, zero macOS CSD dots, zero pill shapes, and token-only color usage.
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
      findFiles(full, exts, acc);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      acc.push(full);
    }
  }
  return acc;
}

const files = [
  ...findFiles(UI_SRC, [".tsx", ".ts", ".css"]),
  join(APP_ROOT, "index.html"),
  join(APP_ROOT, "hud.html"),
];
const violations = [];

const BLUR_REGEX = /(?:-webkit-)?backdrop-filter\s*:[^;]*blur\(|backdrop-blur|filter\s*:[^;]*blur\(/i;
const COLOR_FUNCTION_REGEX = /\b(?:rgba?|hsla?)\s*\(/i;
const ALPHA_TOKEN_REGEX = /^\s*--(?:scrim|chart-fade-up|chart-fade-down|shadow-card)\s*:/;
const TW_OPACITY_REGEX =
  /\b(?:bg|text|border|ring|fill|stroke|outline)-[a-zA-Z0-9_[\]-]+\/\d{1,3}\b/;
const TW_COLOR_CLASS_REGEX =
  /\b(?:bg|text|border|ring|fill|stroke|outline)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d{1,3})?\b/g;
const GLOW_REGEX = /\bdrop-shadow(?:\(|-[a-z])/i;
const DARK_SHADOW_CLASS_REGEX =
  /\bshadow-(?:xs|sm|md|lg|xl|2xl|elev-1|elev-2|elev-float|float)\b|shadow-\[/;
const BOX_SHADOW_REGEX = /\bbox-shadow\s*:\s*([^;]+);/i;
const CSD_DOT_REGEX = /\bcsd-dot-(?:close|min|max)\b/;
const PILL_REGEX = /\brounded-full\b/;
const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
const RETIRED_COLOR_REGEX =
  /#(?:050505|06B6D4|08080A|0891B2|09090B|0F1115|10B981|111213|121215|17171C|1A1B1E|1F2125|1FB5A5|202026|202128|22C55E|22D3EE|23232A|2C2E33|33333D|3355FF|38B6F0|5A5B62|6B7280|71717A|7C3AED|7C5CE6|8A8B91|8E8E93|9CA3AF|A1A1AA|A855F7|C8C8D0|E11D48|E2E2E7|E8E8EC|EAB308|EAF0FF|EC4899|F2F2F4|F43F5E|F4F4F5|F4F5F7|F59E0B|F5F5F6|F7F7F8|F97316)\b/gi;
const PALETTE_FILES = new Set([
  "src/styles/linear-theme.css",
  "src/styles/recording-tokens.css",
]);

for (const file of files) {
  const rel = relative(APP_ROOT, file);
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const isPaletteFile = PALETTE_FILES.has(rel);
  const isLinearTheme = rel === "src/styles/linear-theme.css";
  const isTestFile = /(?:\.test|\.spec)\./.test(rel) || rel.includes("/test/");

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      return;
    }

    if (!isTestFile && BLUR_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden blur rule`);
    }

    if (COLOR_FUNCTION_REGEX.test(line) && !(isLinearTheme && ALPHA_TOKEN_REGEX.test(line))) {
      violations.push(`${rel}:${lineNo} color functions are restricted to approved theme alpha tokens`);
    }

    const opacityMatches = isTestFile ? null : line.match(TW_OPACITY_REGEX);
    if (opacityMatches) {
      violations.push(
        `${rel}:${lineNo} forbidden Tailwind opacity modifier (${opacityMatches.join(", ")})`,
      );
    }

    if (!isTestFile && GLOW_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden glow / drop-shadow`);
    }

    const shadowMatch = isTestFile ? null : line.match(BOX_SHADOW_REGEX);
    if (shadowMatch && shadowMatch[1].trim() !== "var(--shadow-card)") {
      violations.push(`${rel}:${lineNo} only box-shadow: var(--shadow-card) is allowed`);
    }

    if (!isTestFile && !isPaletteFile && DARK_SHADOW_CLASS_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden non-token / dark-mode shadow utility`);
    }

    const colorClassMatches = line.match(TW_COLOR_CLASS_REGEX);
    if (colorClassMatches) {
      violations.push(`${rel}:${lineNo} Tailwind palette color class (${colorClassMatches.join(", ")})`);
    }

    if (!isTestFile && CSD_DOT_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} forbidden macOS CSD traffic-light dot`);
    }

    if (!isTestFile && PILL_REGEX.test(line) && !line.includes("linear-exception:")) {
      violations.push(
        `${rel}:${lineNo} forbidden rounded-full pill (use 4px/6px/8px rounding or mark status dot)`,
      );
    }

    const retiredMatches = line.match(RETIRED_COLOR_REGEX);
    if (retiredMatches) {
      violations.push(`${rel}:${lineNo} retired palette value (${retiredMatches.join(", ")})`);
    }

    if (!isPaletteFile) {
      const hexMatches = line.match(HEX_COLOR_REGEX);
      if (hexMatches) {
        violations.push(
          `${rel}:${lineNo} raw hex color outside palette token files (${hexMatches.join(", ")})`,
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
  "✅ check:linear gate PASSED: token colors, allowed alpha/shadow roles, opaque surfaces, no blur or palette utilities verified.",
);
