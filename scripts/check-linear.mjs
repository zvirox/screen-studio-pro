#!/usr/bin/env node
/**
 * Unified Linear-Style Design System Gate (ScreenStudio Pro).
 * Enforces opaque surfaces, hairline borders, zero blur, restricted alpha/shadows,
 * zero glow, zero macOS CSD dots, zero pill shapes, token-only color usage,
 * no green/teal hues, no foreign-app primary accents, no charts, and token sync.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
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
const GREEN_CLASS_REGEX =
  /\b(?:bg|text|border|ring|fill|stroke|outline)-(?:green|emerald|teal|lime)-\d{2,3}\b/g;
const GLOW_REGEX = /\bdrop-shadow(?:\(|-[a-z])/i;
const DARK_SHADOW_CLASS_REGEX =
  /\bshadow-(?:xs|sm|md|lg|xl|2xl|elev-1|elev-2|elev-float|float)\b|shadow-\[/;
const BOX_SHADOW_REGEX = /\bbox-shadow\s*:\s*([^;]+);/i;
const CSD_DOT_REGEX = /\bcsd-dot-(?:close|min|max)\b/;
const PILL_REGEX = /\brounded-full\b/;
const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
const RETIRED_COLOR_REGEX =
  /#(?:050505|059669|08080A|0891B2|09090B|0ACC8A|0D9488|0F1115|10B981|111213|121215|15803D|17171C|1A1B1E|1A9942|1B2531|1C261E|1F2125|1FB5A5|202026|202128|22C55E|23232A|2C2E33|33333D|3355FF|3483FF|38B6F0|38C84F|5A5B62|6B7280|71717A|7C3AED|7C5CE6|831843|8A8B91|8E8E93|9CA3AF|A1A1AA|A855F7|C8C8D0|DBEAFE|DCFCE7|E2E2E7|E8E8EC|EAB308|EAF0FF|EC4899|F2F2F4|F43F5E|F4F4F5|F4F5F7|F59E0B|F5F5F6|F7F7F8)\b/gi;
const FOREIGN_PRIMARY_REGEX =
  /#(?:06B6D4|0C667F|0E7490|193236|1F273C|2157CF|22D3EE|24BFD9|2C213C|2E5DE0|331D36|3B281B|6023BF|6B9BFF|7A36E0|8B3DFF|8F199A|A21CAF|A921BA|AB390B|B28CFF|C026D3|C2410C|E879F9|EEF5F7|F0F4FE|F5F0FC|F8EFF9|F97316|FA8432|FB923C|FBF2EE)\b/gi;
const NO_CHARTS_REGEX = /(?:from\s+["']echarts["']|require\(\s*["']echarts["']\s*\)|echarts-linear-theme)/i;
const PALETTE_FILES = new Set([
  "src/styles/linear-theme.css",
  "src/styles/app-accent.css",
  "src/styles/recording-tokens.css",
]);
const PINNED_TOKENS = new Map([
  ["src/styles/linear-theme.css", "90d28b21ec7d9964400bddfed725802585a51499a9f37ea4d3a4899dd3da4695"],
  ["src/styles/app-accent.css", "93c397ac30645e1f62dc8b5bf37af9c6ca5fba38cd8f3552d1217988e61f6ecf"],
]);

function hexToHue(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

// Token sync: palette files must match their pinned sha256.
for (const [rel, expected] of PINNED_TOKENS) {
  const digest = createHash("sha256").update(readFileSync(join(APP_ROOT, rel), "utf8")).digest("hex");
  if (digest !== expected) {
    violations.push(`${rel} sha256 ${digest} != pinned ${expected} (token file drifted)`);
  }
}

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

    const greenClassMatches = isTestFile ? null : line.match(GREEN_CLASS_REGEX);
    if (greenClassMatches) {
      violations.push(`${rel}:${lineNo} forbidden green/teal/lime class (${greenClassMatches.join(", ")})`);
    }

    if (!isTestFile && NO_CHARTS_REGEX.test(line)) {
      violations.push(`${rel}:${lineNo} charts are removed from this app (echarts / echarts-linear-theme)`);
    }

    const foreignMatches = line.match(FOREIGN_PRIMARY_REGEX);
    if (foreignMatches) {
      violations.push(`${rel}:${lineNo} foreign-app primary accent (${foreignMatches.join(", ")})`);
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
    } else {
      // Green-hue ban applies inside the palette files too (hue 75–170°).
      const hexes = line.match(HEX_COLOR_REGEX);
      if (hexes) {
        for (const hex of hexes) {
          if (hex.length !== 7) continue;
          const hue = hexToHue(hex);
          if (hue >= 75 && hue <= 170) {
            violations.push(`${rel}:${lineNo} forbidden green/teal hue ${hex} (${hue.toFixed(0)}°)`);
          }
        }
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
  "✅ check:linear gate PASSED: token colors, allowed alpha/shadow roles, opaque surfaces, no blur, no green, no foreign primary, no charts, token sync verified.",
);