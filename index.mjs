#!/usr/bin/env node

// Standalone brand project generator for nsp-ds-tokens.
// No dependency on a local nsp-ds-tokens clone: the library is fetched from
// GitHub when the generated project runs `npm install`.
//
// Usage (interactive):     npx github:NSP-Design-System-Tokens/create-nsp-project
// Usage (non-interactive): npx github:NSP-Design-System-Tokens/create-nsp-project <name> <primaryHex> [secondaryHex] [accentHex]

import { createInterface } from "node:readline/promises";
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { execSync } from "node:child_process";

// ── Config ────────────────────────────────────────────────────────────────────
// Bump LIB_VERSION when nsp-ds-tokens cuts a new release.
const LIB_VERSION = "v0.5.0";
const LIB_DEP = `github:NSP-Design-System-Tokens/nsp-ds-tokens#${LIB_VERSION}`;
const LIB_GITHUB_URL =
  "https://github.com/NSP-Design-System-Tokens/nsp-ds-tokens";

// @generated-start:generate-scale
// Canonical OKLCH scale generator. ESM, zero external dependencies.
// Hand-rolled OKLCH engine with binary-search gamut clamping.
// computeOnColor: Opzione A corretta — real neutral grays, dark-mode fallback.

// ── Hex parse/format ─────────────────────────────────────────────────────────

function parseHex(hex) {
  const h = hex.replace(/^#/, "");
  let r,
    g,
    b,
    a = 1;
  if (h.length === 3 || h.length === 4) {
    r = parseInt(h[0] + h[0], 16) / 255;
    g = parseInt(h[1] + h[1], 16) / 255;
    b = parseInt(h[2] + h[2], 16) / 255;
    if (h.length === 4) a = parseInt(h[3] + h[3], 16) / 255;
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
  } else {
    throw new Error(`Invalid hex: ${hex}`);
  }
  return { r, g, b, a };
}

function toHex(r, g, b) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const byte = (v) =>
    Math.round(cl(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function normalizeHex(hex) {
  const { r, g, b } = parseHex(hex);
  return toHex(r, g, b);
}

// ── sRGB gamma ───────────────────────────────────────────────────────────────

function linearize(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function gammaEncode(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ── OKLab ↔ linear sRGB ─────────────────────────────────────────────────────

function linearRGBtoOKLab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearRGB(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

// ── OKLCH ↔ OKLab ────────────────────────────────────────────────────────────

function oklchToOKLab(l, c, h) {
  const hRad = (h * Math.PI) / 180;
  return { L: l, a: c * Math.cos(hRad), b: c * Math.sin(hRad) };
}

function oklabToOKLCH(L, a, b) {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: C, h };
}

// ── Conversions ──────────────────────────────────────────────────────────────

function hexToOKLCH(hex) {
  const { r, g, b } = parseHex(hex);
  const lab = linearRGBtoOKLab(linearize(r), linearize(g), linearize(b));
  return oklabToOKLCH(lab.L, lab.a, lab.b);
}

function oklchToLinearRGB(l, c, h) {
  const { L, a, b } = oklchToOKLab(l, c, h);
  return oklabToLinearRGB(L, a, b);
}

function inGamut(r, g, b) {
  const E = 1e-6;
  return (
    r >= -E && r <= 1 + E && g >= -E && g <= 1 + E && b >= -E && b <= 1 + E
  );
}

function clampChroma(l, c, h) {
  let rgb = oklchToLinearRGB(l, c, h);
  if (inGamut(rgb.r, rgb.g, rgb.b)) return c;
  let lo = 0,
    hi = c;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    rgb = oklchToLinearRGB(l, mid, h);
    if (inGamut(rgb.r, rgb.g, rgb.b)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function formatHexOKLCH(l, c, h) {
  const cc = clampChroma(l, c, h);
  const rgb = oklchToLinearRGB(l, cc, h);
  return toHex(gammaEncode(rgb.r), gammaEncode(rgb.g), gammaEncode(rgb.b));
}

// ── Contrast math ────────────────────────────────────────────────────────────

function composeOver(fg, bg) {
  let br = bg.r,
    bgc = bg.g,
    bb = bg.b;
  if (bg.a < 1) {
    br = bg.a * br + (1 - bg.a);
    bgc = bg.a * bgc + (1 - bg.a);
    bb = bg.a * bb + (1 - bg.a);
  }
  return {
    r: fg.a * fg.r + (1 - fg.a) * br,
    g: fg.a * fg.g + (1 - fg.a) * bgc,
    b: fg.a * fg.b + (1 - fg.a) * bb,
  };
}

function luminance({ r, g, b }) {
  const ch = (c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(fgHex, bgHex) {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  const fgEff = composeOver(fg, bg);
  const bgEff =
    bg.a < 1
      ? composeOver(bg, { r: 1, g: 1, b: 1, a: 1 })
      : { r: bg.r, g: bg.g, b: bg.b };
  const l1 = luminance(fgEff);
  const l2 = luminance(bgEff);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// ── Neutral values from tokens/core/color.json ───────────────────────────────
//   gray.1:  light=#fcfcfc  dark=#111111  → palette.neutral.1
//   gray.12: light=#202020  dark=#eeeeee  → palette.neutral.12
//   white:   #ffffff                      → palette.neutral.0

const NEUTRALS = {
  light: {
    light: { hex: "#fcfcfc", ref: "{palette.neutral.1}" },
    dark: { hex: "#202020", ref: "{palette.neutral.12}" },
  },
  dark: {
    light: { hex: "#eeeeee", ref: "{palette.neutral.12}" },
    dark: { hex: "#111111", ref: "{palette.neutral.1}" },
  },
  fallback: { hex: "#ffffff", ref: "{palette.neutral.0}" },
};

// ── computeOnColor (Opzione A corretta) ──────────────────────────────────────

function computeOnColor(backgroundHex, mode) {
  const cands = NEUTRALS[mode];
  const rLight = contrastRatio(cands.light.hex, backgroundHex);
  const rDark = contrastRatio(cands.dark.hex, backgroundHex);

  let chosen, ratio;
  if (rLight >= rDark) {
    chosen = cands.light;
    ratio = rLight;
  } else {
    chosen = cands.dark;
    ratio = rDark;
  }

  const passed = ratio >= 4.5;

  if (mode === "dark" && !passed) {
    const rFallback = contrastRatio(NEUTRALS.fallback.hex, backgroundHex);
    if (rFallback > ratio) {
      return {
        hex: NEUTRALS.fallback.hex,
        ref: NEUTRALS.fallback.ref,
        ratio: rFallback,
        passed: rFallback >= 4.5,
        fallback: true,
      };
    }
  }

  return { hex: chosen.hex, ref: chosen.ref, ratio, passed, fallback: false };
}

// ── computeOnColorPair (dual-mode aggregation) ──────────────────────────────

function computeOnColorPair(lightSurfaceHex, darkSurfaceHex) {
  const light = computeOnColor(lightSurfaceHex, "light");
  const dark = computeOnColor(darkSurfaceHex, "dark");

  const result = {
    lightHex: light.hex,
    darkHex: dark.hex,
    lightRef: light.ref,
    darkRef: dark.ref,
    lightRatio: light.ratio,
    darkRatio: dark.ratio,
    lightPassed: light.passed,
    darkPassed: dark.passed,
  };

  if (light.fallback) result.lightFallback = true;
  if (dark.fallback) result.darkFallback = true;

  return result;
}

// ── Scale generation ─────────────────────────────────────────────────────────

function generateScale(anchorHex) {
  const base = hexToOKLCH(anchorHex);

  const LIGHT_L = [
    0.985,
    0.97,
    0.94,
    0.91,
    0.87,
    0.82,
    0.74,
    0.63,
    base.l,
    base.l - 0.05,
    base.l - 0.12,
    base.l - 0.22,
  ];
  const DARK_L = [
    0.1,
    0.14,
    0.19,
    0.24,
    0.28,
    0.32,
    0.37,
    0.4,
    base.l,
    base.l + 0.06,
    base.l + 0.18,
    base.l + 0.32,
  ];

  const lightSteps = LIGHT_L.map((l, i) =>
    formatHexOKLCH(l, base.c * (i < 8 ? 0.6 + i * 0.05 : 1), base.h),
  );
  const darkSteps = DARK_L.map((l, i) =>
    formatHexOKLCH(l, base.c * (i < 8 ? 0.5 + i * 0.08 : 1), base.h),
  );

  const anchor = normalizeHex(anchorHex);
  lightSteps[8] = anchor;
  darkSteps[8] = anchor;

  return { lightSteps, darkSteps, anchor };
}

// ── Step selection ───────────────────────────────────────────────────────────

function pickTextStep(lightSteps) {
  const SURFACE_CARD = "#f9f9f9";
  const candidates = [8, 9, 10, 11];
  let best = null;
  for (const idx of candidates) {
    const hex = lightSteps[idx];
    const r = contrastRatio(hex, SURFACE_CARD);
    if (r >= 4.5) return { step: idx + 1, hex, ratio: r, passed: true };
    if (!best || r > best.ratio) best = { idx, hex, ratio: r };
  }
  return {
    step: best.idx + 1,
    hex: best.hex,
    ratio: best.ratio,
    passed: false,
  };
}

function pickIconStep(lightSteps) {
  const candidates = [8, 9, 10, 11, 7];
  let best = null;
  for (const idx of candidates) {
    const hex = lightSteps[idx];
    const r = contrastRatio(hex, "#ffffff");
    if (r >= 3.0) return { step: idx + 1, hex, ratio: r, passed: true };
    if (!best || r > best.ratio) best = { idx, hex, ratio: r };
  }
  return {
    step: best.idx + 1,
    hex: best.hex,
    ratio: best.ratio,
    passed: false,
  };
}

// ── Token tree builders ──────────────────────────────────────────────────────

function buildColorTree(lightSteps, darkSteps, origin) {
  const tree = { $extensions: { nsp: { origin } } };
  for (let i = 0; i < 12; i++) {
    tree[String(i + 1)] = {
      $type: "color",
      $value: lightSteps[i],
      $extensions: {
        "com.figma.modes": { light: lightSteps[i], dark: darkSteps[i] },
      },
    };
  }
  return tree;
}

function brandSlot(hueRef, origin) {
  const slot = {};
  for (let i = 1; i <= 12; i++)
    slot[String(i)] = { $type: "color", $value: `{${hueRef}.${i}}` };
  slot.default = { $type: "color", $value: `{${hueRef}.9}` };
  slot.subtle = { $type: "color", $value: `{${hueRef}.3}` };
  slot.hover = { $type: "color", $value: `{${hueRef}.10}` };
  slot.$extensions = { nsp: { origin } };
  return slot;
}

function ghostSlot(hueRef, origin) {
  const slot = {};
  for (let i = 1; i <= 12; i++)
    slot[String(i)] = { $type: "color", $value: `{${hueRef}.${i}}` };
  slot.default = { $type: "color", $value: `{${hueRef}.3}` };
  slot.hover = { $type: "color", $value: `{${hueRef}.4}` };
  slot.active = { $type: "color", $value: `{${hueRef}.5}` };
  slot.text = { $type: "color", $value: `{${hueRef}.11}` };
  slot.$extensions = { nsp: { origin } };
  return slot;
}

function graySlot(origin) {
  const slot = {};
  for (let i = 1; i <= 12; i++)
    slot[String(i)] = { $type: "color", $value: `{palette.neutral.${i}}` };
  slot.default = { $type: "color", $value: "{palette.neutral.9}" };
  slot.$extensions = { nsp: { origin } };
  return slot;
}
// @generated-end:generate-scale

// ── readline helpers ──────────────────────────────────────────────────────────

async function prompt(rl, question, validate) {
  while (true) {
    const answer = (await rl.question(question)).trim();
    if (!validate) return answer;
    const err = validate(answer);
    if (!err) return answer;
    console.error(`  ✗ ${err}`);
  }
}

function validateName(v) {
  if (!v) return "Name is required";
  if (!/^[a-z][a-z0-9-]*$/.test(v))
    return "Name must be lowercase kebab-case (letters, digits, hyphens)";
  return null;
}

function validateHex(v) {
  if (!v) return null;
  try {
    parseHex(v);
    return null;
  } catch {
    return `Cannot parse "${v}" — use a hex value like #2563eb`;
  }
}

function validateRequiredHex(v) {
  if (!v) return "Color hex is required";
  return validateHex(v);
}

// ── token builders ────────────────────────────────────────────────────────────

const ct = (light, dark) => ({
  $type: "color",
  $value: light,
  $extensions: { "com.figma.modes": { light, dark } },
});

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const [, , argName, argPrimary, argSecondary, argAccent] = process.argv;

    console.log(
      "\n── create-nsp-project ─────────────────────────────────────\n",
    );

    // 1. Gather inputs
    const name =
      argName ??
      (await prompt(rl, "Project name (kebab-case): ", validateName));

    const nameErr = validateName(name);
    if (nameErr) {
      console.error(`✗ ${nameErr}`);
      process.exit(1);
    }

    const dest = resolve(process.cwd(), `nsp-ds-tokens-${name}`);
    if (existsSync(dest)) {
      console.error(`✗ Directory already exists: ${dest}`);
      process.exit(1);
    }

    const primaryHex =
      argPrimary ??
      (await prompt(rl, "Primary brand color (#hex): ", validateRequiredHex));

    const secondaryRaw =
      argSecondary !== undefined
        ? argSecondary
        : await prompt(
            rl,
            "Secondary color (#hex, or Enter = auto soft-tint from primary): ",
            validateHex,
          );

    // Accent is a distinct optional fourth color. Enter (or omitting the arg
    // in non-interactive mode) skips the slot — no palette.accent, no emphasis.*.
    // In non-interactive mode (argName provided) an absent accent is a silent skip.
    const accentRaw =
      argAccent !== undefined
        ? argAccent
        : argName !== undefined
          ? ""
          : await prompt(
              rl,
              "Accent color (#hex, or Enter = skip accent slot): ",
              validateHex,
            );

    // Secondary empty → shares the primary scale; palette.secondary.3 gives
    // a natural soft-tint surface without generating a separate color file.
    const secondaryHex = secondaryRaw || primaryHex;
    const hasAccent = Boolean(accentRaw);
    const accentHex = hasAccent ? accentRaw : null;

    // 2. Generate scales
    console.log("\nGenerating color scales...");

    const primaryScale = generateScale(primaryHex);
    const secondaryScale =
      secondaryHex === primaryHex ? primaryScale : generateScale(secondaryHex);
    const accentScale = !hasAccent
      ? null
      : accentHex === primaryHex
        ? primaryScale
        : accentHex === secondaryHex
          ? secondaryScale
          : generateScale(accentHex);

    const primaryKey = name;
    const secondaryKey =
      secondaryScale === primaryScale ? name : `${name}-secondary`;
    const accentKey = !hasAccent
      ? null
      : accentScale === primaryScale
        ? name
        : accentScale === secondaryScale
          ? secondaryKey
          : `${name}-accent`;

    const primaryRef = `color.${primaryKey}`;
    const secondaryRef = `color.${secondaryKey}`;
    const accentRef = hasAccent ? `color.${accentKey}` : null;
    const origin = "brand";

    console.log(`  ✓ ${primaryRef}: step 9 = ${primaryScale.anchor}`);
    if (secondaryScale !== primaryScale)
      console.log(`  ✓ ${secondaryRef}: step 9 = ${secondaryScale.anchor}`);
    if (
      hasAccent &&
      accentScale !== primaryScale &&
      accentScale !== secondaryScale
    )
      console.log(`  ✓ color.${accentKey}: step 9 = ${accentScale.anchor}`);
    if (!hasAccent) console.log(`  — accent: skipped`);

    // 3. Auto-select on-colors for every role and every surface state, in both modes.
    //
    // Primary: surface.primary = step 9 (both modes, same anchor hex).
    //          surface.primary-hover/dark = step 10 light / step 8 dark.
    // Secondary: surface.secondary = step 3 (same step in both modes).
    //            surface.secondary-hover = step 4, secondary-active = step 5.
    //
    // Steps are evaluated independently per mode so that a surface that inverts
    // from bright (light) to dark (dark) gets the correct foreground in each.

    // Primary base surface (step 9, same hex in both modes)
    const onPrimary = computeOnColorPair(
      primaryScale.lightSteps[8],
      primaryScale.darkSteps[8],
    );

    // Primary hover/active surface (step 10 in light, step 8 in dark)
    const onPrimaryHover = computeOnColorPair(
      primaryScale.lightSteps[9],
      primaryScale.darkSteps[7],
    );

    // When hover needs a different foreground in either mode, generate extra tokens
    // and add CONTRAST_EXEMPT so the base on-primary is not gated against states
    // it was never designed to cover.
    const primaryHoverDiffers =
      onPrimary.lightRef !== onPrimaryHover.lightRef ||
      onPrimary.darkRef !== onPrimaryHover.darkRef;

    // Primary active surface (step 11 in light, step 7 in dark)
    const onPrimaryActive = computeOnColorPair(
      primaryScale.lightSteps[10],
      primaryScale.darkSteps[6],
    );
    const primaryActiveDiffers =
      onPrimary.lightRef !== onPrimaryActive.lightRef ||
      onPrimary.darkRef !== onPrimaryActive.darkRef;

    // Secondary: surface.secondary = step 3 (same step in both modes)
    const onSecondary = computeOnColorPair(
      secondaryScale.lightSteps[2],
      secondaryScale.darkSteps[2],
    );

    // Text/icon steps on white (light mode) for brand-colored foregrounds
    const textSel = pickTextStep(primaryScale.lightSteps);
    const iconSel = pickIconStep(primaryScale.lightSteps);

    // Secondary icon step on white — must be computed from the secondary scale,
    // not hardcoded. pickIconStep scans step 9→12→8 and finds the first step
    // that achieves 3:1; returns best available when none pass.
    const secondaryIconSel = pickIconStep(secondaryScale.lightSteps);

    // 4. Report selections
    console.log("\nAuto-selected on-color:");

    const logOnColor = (label, surfaceHex, on) => {
      const dir = on.lightHex === "#ffffff" ? "white" : "black";
      const flag = on.lightPassed ? "✓" : "⚠ below 4.5:1";
      console.log(
        `  ${label} (${surfaceHex}): ${dir} — light ${on.lightRatio.toFixed(2)}:1 ${flag}, dark ${on.darkRatio.toFixed(2)}:1 ${on.darkPassed ? "✓" : "⚠ below 4.5:1"}`,
      );
    };

    logOnColor("on-primary (step 9)", primaryScale.anchor, onPrimary);
    if (primaryHoverDiffers) {
      logOnColor(
        "on-primary-hover (step10L/step8D)",
        `${primaryScale.lightSteps[9]}/${primaryScale.darkSteps[7]}`,
        onPrimaryHover,
      );
      console.log(
        `  ⚠ Primary hover state needs different foreground in dark mode.\n` +
          `    Generating text/icon.on-primary-hover tokens.\n` +
          `    Adding CONTRAST_EXEMPT for icon.on-primary × primary-hover (REAL GAP).`,
      );
    }
    if (primaryActiveDiffers) {
      logOnColor(
        "on-primary-active (step11L/step7D)",
        `${primaryScale.lightSteps[10]}/${primaryScale.darkSteps[6]}`,
        onPrimaryActive,
      );
      console.log(
        `  ⚠ Primary active state needs different foreground in dark mode.\n` +
          `    Generating text/icon.on-primary-active tokens.\n` +
          `    Adding CONTRAST_EXEMPT for icon.on-primary × primary-active (REAL GAP).`,
      );
    }

    const secLabel =
      secondaryScale === primaryScale ? "secondary=primary" : "on-secondary";
    logOnColor(
      `${secLabel} (step3L/step3D)`,
      `${secondaryScale.lightSteps[2]}/${secondaryScale.darkSteps[2]}`,
      onSecondary,
    );

    console.log(
      `  brand text step: ${textSel.step} (${textSel.hex}, ${textSel.ratio.toFixed(2)}:1) ${textSel.passed ? "✓" : "⚠ no step achieves 4.5:1 on white"}`,
    );
    if (!textSel.passed)
      console.warn(
        `  ⚠ Primary color is too light for accessible text on white.\n` +
          `    text.primary/text.title will use step ${textSel.step} (best available).\n` +
          `    Consider using a darker primary or adding contrast exemptions.`,
      );

    console.log(
      `  icon step (primary): ${iconSel.step} (${iconSel.hex}, ${iconSel.ratio.toFixed(2)}:1) ${iconSel.passed ? "✓" : "⚠ no step achieves 3:1 on white"}`,
    );

    if (secondaryScale !== primaryScale) {
      console.log(
        `  icon step (secondary): ${secondaryIconSel.step} (${secondaryIconSel.hex}, ${secondaryIconSel.ratio.toFixed(2)}:1) ${secondaryIconSel.passed ? "✓" : "⚠ no step achieves 3:1 on white"}`,
      );
      if (!secondaryIconSel.passed)
        console.warn(
          `  ⚠ Secondary color ${secondaryScale.anchor} is too light for accessible icons on white.\n` +
            `    icon.secondary will use step ${secondaryIconSel.step} (best: ${secondaryIconSel.ratio.toFixed(2)}:1 < 3.0).\n` +
            `    Adding CONTRAST_EXEMPT for icon.secondary (PHYSICAL limitation).\n` +
            `    Consider using a darker secondary for accessible icon rendering on white.`,
        );
    }

    // 5. Build BRAND_EXEMPT for project-specific contrast gaps
    const BRAND_EXEMPT = {};

    if (primaryHoverDiffers) {
      const hoverDarkHex = primaryScale.darkSteps[7];
      const msg =
        `REAL GAP — dark mode only: surface.primary-hover = step 10 light / step 8 dark` +
        ` (${primaryScale.lightSteps[9]}/${hoverDarkHex}), requires ${onPrimaryHover.darkHex} text;` +
        ` on-primary uses ${onPrimary.darkRef.replace(/[{}]/g, "")} for the base surface.` +
        ` Use text/icon.on-primary-hover for hover states.`;
      BRAND_EXEMPT["icon.on-primary × surface.primary-hover"] = msg;
    }

    if (primaryActiveDiffers) {
      const activeDarkHex = primaryScale.darkSteps[6];
      const msg =
        `REAL GAP — dark mode only: surface.primary-active = step 11 light / step 7 dark` +
        ` (${primaryScale.lightSteps[10]}/${activeDarkHex}), requires ${onPrimaryActive.darkHex} text;` +
        ` on-primary uses ${onPrimary.darkRef.replace(/[{}]/g, "")} for the base surface.` +
        ` Use text/icon.on-primary-active for pressed/active states.`;
      BRAND_EXEMPT["icon.on-primary × surface.primary-active"] = msg;
    }

    if (!secondaryIconSel.passed && secondaryScale !== primaryScale) {
      BRAND_EXEMPT["icon.secondary"] =
        `PHYSICAL — secondary color ${secondaryScale.anchor} has no step` +
        ` achieving 3:1 on white (best: step ${secondaryIconSel.step}` +
        ` ${secondaryIconSel.hex} = ${secondaryIconSel.ratio.toFixed(2)}:1).` +
        ` Use a darker secondary color for accessible icon rendering on white.`;
    }

    // 6. Create directory + package.json
    console.log("\nWriting project files...");
    mkdirSync(dest, { recursive: true });

    const write = (rel, content) => {
      const p = resolve(dest, rel);
      mkdirSync(dirname(p), { recursive: true });
      const str =
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2) + "\n";
      writeFileSync(p, str);
    };

    write("package.json", {
      name: `nsp-ds-tokens-${name}`,
      version: "0.1.0",
      type: "module",
      description: `${name} brand tokens — extends nsp-ds-tokens.`,
      scripts: {
        validate: "node scripts/validate.mjs",
        "contrast-report": "node scripts/validate.mjs",
        "build:figma": "node scripts/build-figma.mjs",
        "build:css": "node scripts/build-css.mjs",
        "build:preview": "node scripts/build-preview.mjs",
        build:
          "npm run validate && npm run build:figma && npm run build:css && npm run build:preview",
      },
      dependencies: {
        culori: "^4.0.1",
        "nsp-ds-tokens": LIB_DEP,
      },
    });

    write(".gitignore", "node_modules/\nbuild/\ndist/\n");

    // 7. npm install — downloads nsp-ds-tokens from GitHub
    console.log(
      `\nRunning npm install (fetches nsp-ds-tokens ${LIB_VERSION} from GitHub)...`,
    );
    try {
      execSync("npm install", { cwd: dest, stdio: "inherit" });
    } catch {
      console.error(
        "✗ npm install failed — run it manually in the project directory.",
      );
      process.exit(1);
    }

    // 8. Copy build + validate scripts from the installed library
    const libScriptsDir = resolve(dest, "node_modules/nsp-ds-tokens/scripts");
    for (const s of [
      "validate.mjs",
      "build-figma.mjs",
      "build-css.mjs",
      "build-preview.mjs",
    ]) {
      const dst = resolve(dest, "scripts", s);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(join(libScriptsDir, s), dst);
    }

    // 9. Write lib/ wrappers
    write(
      "scripts/lib/tokens.mjs",
      `// Wrapper: re-export from nsp-ds-tokens, override loadMerged to include brand tokens.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export {
  isLeaf,
  eachLeaf,
  listModes,
  pickMode,
  subtreeOf,
  TIERS,
  COLOR_MODE_GROUPS,
  RESP_MODE_GROUPS,
  LAYOUT_MODE_GROUPS,
} from "nsp-ds-tokens/scripts/lib/tokens.mjs";

import { loadMergedWith } from "nsp-ds-tokens/scripts/lib/tokens.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const TOKENS_DIR = resolve(ROOT, "tokens");

export function loadMerged() {
  return loadMergedWith([TOKENS_DIR]);
}
`,
    );

    // contrast.mjs: extends base CONTRAST_EXEMPT with brand-specific gaps and
    // overrides checkContrast so the validate gate uses the merged exempt list.
    const brandExemptEntries = Object.entries(BRAND_EXEMPT)
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
      .join("\n");

    write(
      "scripts/lib/contrast.mjs",
      `import {
  CONTRAST_EXEMPT as BASE_EXEMPT,
  contrast,
  resolveColor,
  thresholdFor,
  derivePairs,
} from "nsp-ds-tokens/scripts/lib/contrast.mjs";

export { contrast, resolveColor, thresholdFor, derivePairs };

// Brand-specific contrast exemptions (generated by create-nsp-project).
// Keys match the checkContrast pair format: "fg.token" or "fg.token × bg.token".
const BRAND_EXEMPT = {
${brandExemptEntries}
};

export const CONTRAST_EXEMPT = { ...BASE_EXEMPT, ...BRAND_EXEMPT };

export function checkContrast(merged) {
  const results = [];
  const failures = [];
  for (const { fg, bg, mode } of derivePairs(merged)) {
    const fgHex = resolveColor(merged, fg, mode);
    const bgHex = resolveColor(merged, bg, mode);
    if (!fgHex || !bgHex) continue;
    const ratio = contrast(fgHex, bgHex);
    const group = fg.split(".")[0];
    const threshold = thresholdFor(group);
    const pairKey = \`\${fg} × \${bg}\`;
    let status;
    if (CONTRAST_EXEMPT[fg] || CONTRAST_EXEMPT[pairKey]) status = "exempt";
    else if (ratio < threshold) status = "FAIL";
    else status = "ok";
    const row = { fg, bg, mode, fgHex, bgHex, ratio, threshold, status };
    results.push(row);
    if (status === "FAIL") failures.push(row);
  }
  return { results, failures };
}
`,
    );

    write(
      "scripts/lib/origin.mjs",
      `export * from "nsp-ds-tokens/scripts/lib/origin.mjs";\n`,
    );

    // 10. Token files
    const colorJson = { color: {} };
    colorJson.color[primaryKey] = buildColorTree(
      primaryScale.lightSteps,
      primaryScale.darkSteps,
      origin,
    );
    if (secondaryScale !== primaryScale)
      colorJson.color[secondaryKey] = buildColorTree(
        secondaryScale.lightSteps,
        secondaryScale.darkSteps,
        origin,
      );
    if (
      hasAccent &&
      accentScale !== primaryScale &&
      accentScale !== secondaryScale
    )
      colorJson.color[accentKey] = buildColorTree(
        accentScale.lightSteps,
        accentScale.darkSteps,
        origin,
      );
    write("tokens/core/color.json", colorJson);

    write(`tokens/brand/${name}.json`, {
      palette: {
        $extensions: { "com.figma.scoping": [] },
        primary: brandSlot(primaryRef, origin),
        secondary:
          secondaryScale === primaryScale
            ? ghostSlot(secondaryRef, origin)
            : brandSlot(secondaryRef, origin),
        ...(hasAccent ? { accent: brandSlot(accentRef, origin) } : {}),
      },
    });

    const ps = (n) => `{palette.primary.${n}}`;
    const ts = textSel.step;
    const th = Math.min(ts + 1, 12);
    const is_ = iconSel.step;
    const ih = Math.min(is_ + 1, 12);

    // Per-state on-color tokens are generated when hover/active surfaces need a
    // different foreground than the base surface (always the case when a bright
    // identity color inverts to dark in the dark-mode step).
    const hoverOnTokens = primaryHoverDiffers
      ? {
          "on-primary-hover": ct(
            onPrimaryHover.lightRef,
            onPrimaryHover.darkRef,
          ),
        }
      : {};

    const activeOnTokens = primaryActiveDiffers
      ? {
          "on-primary-active": ct(
            onPrimaryActive.lightRef,
            onPrimaryActive.darkRef,
          ),
        }
      : {};

    write("tokens/semantic/color.json", {
      surface: {
        // Primary family: solid → interaction → lighter → lightest
        primary: ct(ps(9), ps(9)),
        "primary-hover": ct(ps(10), ps(8)),
        "primary-active": ct(ps(11), ps(7)),
        "primary-light": ct(ps(8), ps(10)),
        "primary-xlight": ct(ps(3), ps(10)),
        // Secondary family (ghost/soft)
        secondary: ct("{palette.secondary.3}", "{palette.secondary.3}"),
        "secondary-hover": ct("{palette.secondary.4}", "{palette.secondary.4}"),
        "secondary-active": ct(
          "{palette.secondary.5}",
          "{palette.secondary.5}",
        ),
        // Tertiary family (neutral accent)
        tertiary: ct("{palette.tertiary.3}", "{palette.tertiary.3}"),
        "tertiary-hover": ct("{palette.tertiary.4}", "{palette.tertiary.4}"),
        "tertiary-active": ct("{palette.tertiary.5}", "{palette.tertiary.5}"),
      },
      text: {
        // Core brand text — step 11 both modes (brand coherence over WCAG escalation)
        title: ct(ps(11), ps(11)),
        primary: ct(ps(11), ps(11)),
        // Primary family variants: base → hover
        "primary-hover": ct(ps(th), ps(12)),
        // On-color tokens (paired with brand surfaces)
        "on-primary": ct(onPrimary.lightRef, onPrimary.darkRef),
        ...hoverOnTokens,
        ...activeOnTokens,
        "on-secondary": ct(onSecondary.lightRef, onSecondary.darkRef),
      },
      stroke: {
        primary: ct(ps(is_), ps(11)),
        hover: ct(ps(ih), ps(11)),
      },
      icon: {
        // Primary family: base → hover → light (matches surface pattern)
        // step 11 both modes — consistent with text.title/text.primary policy
        primary: ct(ps(11), ps(11)),
        "primary-hover": ct(ps(ih), ps(12)),
        "primary-light": ct(ps(8), ps(11)),
        // Secondary
        secondary: ct(
          `{palette.secondary.${secondaryIconSel.step}}`,
          "{palette.secondary.12}",
        ),
        // On-color tokens (paired with brand surfaces)
        "on-primary": ct(onPrimary.lightRef, onPrimary.darkRef),
        ...hoverOnTokens,
        ...activeOnTokens,
        "on-secondary": ct(onSecondary.lightRef, onSecondary.darkRef),
      },
      ...(hasAccent
        ? {
            emphasis: {
              default: ct(
                "{palette.accent.default}",
                "{palette.accent.subtle}",
              ),
              subtle: ct("{palette.accent.2}", "{palette.accent.4}"),
            },
          }
        : {}),
    });

    // 11. CLAUDE.md
    const onPrimaryDir = onPrimary.lightHex === "#ffffff" ? "white" : "black";
    const colorLines = [
      `- Primary (step 9): \`${primaryScale.anchor}\``,
      ...(secondaryScale !== primaryScale
        ? [`- Secondary (step 9): \`${secondaryScale.anchor}\``]
        : []),
      ...(!hasAccent
        ? [`- Accent: not generated (slot skipped)`]
        : accentScale !== primaryScale && accentScale !== secondaryScale
          ? [`- Accent (step 9): \`${accentScale.anchor}\``]
          : [
              `- Accent: shares ${accentScale === primaryScale ? "primary" : "secondary"} scale`,
            ]),
      `- text/icon.on-primary: ${onPrimaryDir} (${onPrimary.lightRatio.toFixed(2)}:1 on primary.9)`,
      ...(primaryHoverDiffers
        ? [
            `- text/icon.on-primary-hover: computed per mode (hover surface needs different foreground in dark)`,
          ]
        : []),
      ...(primaryActiveDiffers
        ? [
            `- text/icon.on-primary-active: computed per mode (active/pressed surface needs different foreground in dark)`,
          ]
        : []),
    ].join("\n");

    write(
      "CLAUDE.md",
      `# CLAUDE.md — nsp-ds-tokens-${name}

Brand token project for **${name}**. Extends [nsp-ds-tokens](${LIB_GITHUB_URL}) (${LIB_VERSION}).

## What this is

All spacing, typography, motion, z-index, radius, neutral palette, state palette
(error/success/warning), and base semantic roles live in nsp-ds-tokens.
This repo adds only what is ${name}-specific.

## Tier map

\`\`\`
tokens/
  core/color.json     ← ${name} brand color scale (12 steps, light + dark)
  brand/${name}.json  ← palette slot aliases: primary, secondary${hasAccent ? ", accent" : ""} (tertiary inherited from base)
  semantic/color.json ← brand semantic roles: surface.primary, text.on-primary, …
\`\`\`

## Colors

${colorLines}

## Build

\`\`\`bash
npm run validate     # dangling refs, mode coverage, naming, origin check
npm run build        # validate + figma + css + preview
\`\`\`

Outputs: \`dist/figma-variables.json\`, \`dist/figma-styles.json\`,
\`build/css/tokens.css\`, \`build/tailwind/tokens.cjs\`, \`build/preview/index.html\`.

## Rules

1. Never edit \`node_modules/\`, \`build/\`, or \`dist/\`.
2. Brand-specific tokens only: neutral/state palette, base semantic, spacing, type,
   layout all come from nsp-ds-tokens and are not duplicated here.
3. Semantic tokens reference \`palette.*\` slots — never \`color.*\` directly.
4. Origin marker on every color primitive group and palette slot: \`"${origin}"\`.
5. \`npm run validate\` must pass before committing.
`,
    );

    console.log("  ✓ Token files written");

    // 12. Build + gate
    console.log("\nRunning npm run build...");
    let buildOutput = "";
    let buildPassed = false;
    try {
      buildOutput = execSync("npm run build 2>&1", {
        cwd: dest,
        encoding: "utf8",
      });
      buildPassed = true;
    } catch (e) {
      buildOutput = e.stdout ?? String(e.message);
    }

    process.stdout.write(buildOutput);

    if (buildPassed) {
      console.log(`\n✓ Project ready at ${dest}`);
      console.log(`\nNext steps:`);
      console.log(`  cd nsp-ds-tokens-${name}`);
      console.log(`  open build/preview/index.html`);
      console.log(`  # Import dist/ in Figma via Token Manager plugin`);
    } else {
      const contrastLines = buildOutput
        .split("\n")
        .filter((l) => l.includes("contrast:"))
        .map((l) => l.trim());
      if (contrastLines.length > 0) {
        console.error(
          `\n⚠ Build failed: ${contrastLines.length} contrast issue(s).`,
        );
        console.error(
          "  Adjust palette slot steps in tokens/semantic/color.json,",
        );
        console.error(
          "  or add brand-specific exemptions to scripts/lib/contrast.mjs (BRAND_EXEMPT).",
        );
      } else {
        console.error(`\n✗ Build failed. Check output above.`);
      }
      console.error(`Project directory: ${dest}`);
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
