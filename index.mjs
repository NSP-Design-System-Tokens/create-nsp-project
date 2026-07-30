#!/usr/bin/env node

// Standalone brand project generator for nsp-ds-tokens.
// No dependency on a local nsp-ds-tokens clone: the library is fetched from
// GitHub when the generated project runs `npm install`.
//
// Usage (interactive):     npx github:asimonato/create-nsp-project
// Usage (non-interactive): npx github:asimonato/create-nsp-project <name> <primaryHex> [secondaryHex] [accentHex]

import { createInterface } from "node:readline/promises";
import {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { oklch, formatHex, clampChroma, parse } from "culori";

// ── Config ────────────────────────────────────────────────────────────────────
// Bump LIB_VERSION when nsp-ds-tokens cuts a new release.
const LIB_VERSION = "v0.3.0";
const LIB_DEP = `github:asimonato/nsp-ds-tokens#${LIB_VERSION}`;
const LIB_GITHUB_URL = "https://github.com/asimonato/nsp-ds-tokens";

// ── Inline contrast ratio ─────────────────────────────────────────────────────
// Inlined so this tool has no dependency on nsp-ds-tokens being installed locally.

function toRGBA(value) {
  const v = String(value).trim();
  if (v.startsWith("oklch"))
    return toRGBA(formatHex(clampChroma(oklch(v), "oklch")));
  const c = parse(v);
  if (!c) throw new Error(`cannot parse color: ${value}`);
  return { r: c.r ?? 0, g: c.g ?? 0, b: c.b ?? 0, a: c.alpha ?? 1 };
}

function composeOver(fg, bg) {
  const br = bg.a < 1 ? bg.a * bg.r + (1 - bg.a) : bg.r;
  const bgc = bg.a < 1 ? bg.a * bg.g + (1 - bg.a) : bg.g;
  const bb = bg.a < 1 ? bg.a * bg.b + (1 - bg.a) : bg.b;
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

function contrast(fgColor, bgColor) {
  const fg = toRGBA(fgColor);
  const bg = toRGBA(bgColor);
  const fgEff = composeOver(fg, bg);
  const bgEff =
    bg.a < 1
      ? composeOver(bg, { r: 1, g: 1, b: 1, a: 1 })
      : { r: bg.r, g: bg.g, b: bg.b };
  const hi = Math.max(luminance(fgEff), luminance(bgEff));
  const lo = Math.min(luminance(fgEff), luminance(bgEff));
  return (hi + 0.05) / (lo + 0.05);
}

// ── Color scale generation ────────────────────────────────────────────────────
// 12-step OKLCH scale anchored at the brand hex (step 9 = exact input).

function generateScale(anchorHex) {
  const base = oklch(anchorHex);
  if (!base) throw new Error(`Cannot parse color: ${anchorHex}`);

  const LIGHT_L = [
    0.985, 0.97, 0.94, 0.91, 0.87, 0.82, 0.74, 0.63,
    base.l, base.l - 0.05, base.l - 0.12, base.l - 0.22,
  ];
  const DARK_L = [
    0.1, 0.14, 0.19, 0.24, 0.28, 0.32, 0.37, 0.4,
    base.l, base.l + 0.06, base.l + 0.18, base.l + 0.32,
  ];

  const mkStep = (l, c, h) =>
    formatHex(clampChroma({ mode: "oklch", l, c, h }, "oklch"));

  const lightSteps = LIGHT_L.map((l, i) =>
    mkStep(l, base.c * (i < 8 ? 0.6 + i * 0.05 : 1), base.h),
  );
  const darkSteps = DARK_L.map((l, i) =>
    mkStep(l, base.c * (i < 8 ? 0.5 + i * 0.08 : 1), base.h),
  );

  const anchor = formatHex(anchorHex);
  lightSteps[8] = anchor;
  darkSteps[8] = anchor;

  return { lightSteps, darkSteps, anchor };
}

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

// ── on-color selection ────────────────────────────────────────────────────────

function pickOnColor(step9Hex) {
  const WHITE = "#ffffff";
  const BLACK = "#000000";
  const ratioWhite = contrast(WHITE, step9Hex);
  const ratioBlack = contrast(BLACK, step9Hex);
  if (ratioWhite >= 4.5)
    return { lightRef: "{palette.neutral.0}", darkRef: "{palette.neutral.0}", hex: WHITE, ratio: ratioWhite, passed: true };
  if (ratioBlack >= 4.5)
    return { lightRef: "{palette.neutral.12}", darkRef: "{palette.neutral.1}", hex: BLACK, ratio: ratioBlack, passed: true };
  if (ratioWhite >= ratioBlack)
    return { lightRef: "{palette.neutral.0}", darkRef: "{palette.neutral.0}", hex: WHITE, ratio: ratioWhite, passed: false };
  return { lightRef: "{palette.neutral.12}", darkRef: "{palette.neutral.1}", hex: BLACK, ratio: ratioBlack, passed: false };
}

function pickTextStep(lightSteps) {
  const WHITE = "#ffffff";
  for (const idx of [8, 9, 10, 11]) {
    const hex = lightSteps[idx];
    if (contrast(hex, WHITE) >= 4.5) return { step: idx + 1, hex, passed: true };
  }
  return { step: 12, hex: lightSteps[11], passed: false };
}

function pickIconStep(lightSteps) {
  const WHITE = "#ffffff";
  for (const idx of [8, 9, 10, 11, 7]) {
    const hex = lightSteps[idx];
    if (contrast(hex, WHITE) >= 3.0) return { step: idx + 1, hex, passed: true };
  }
  return { step: 12, hex: lightSteps[11], passed: false };
}

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
  if (!parse(v)) return `Cannot parse "${v}" — use a hex value like #2563eb`;
  return null;
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

function mauveSlot(origin) {
  const slot = {};
  for (let i = 1; i <= 12; i++)
    slot[String(i)] = { $type: "color", $value: `{color.mauve.${i}}` };
  slot.default = { $type: "color", $value: "{color.mauve.9}" };
  slot.$extensions = { nsp: { origin } };
  return slot;
}

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
            "Secondary color (#hex, or Enter = same as primary): ",
            validateHex,
          );

    const accentRaw =
      argAccent !== undefined
        ? argAccent
        : await prompt(
            rl,
            "Accent color (#hex, or Enter = same as primary): ",
            validateHex,
          );

    const secondaryHex = secondaryRaw || primaryHex;
    const accentHex = accentRaw || primaryHex;

    // 2. Generate scales
    console.log("\nGenerating color scales...");

    const primaryScale = generateScale(primaryHex);
    const secondaryScale =
      secondaryHex === primaryHex ? primaryScale : generateScale(secondaryHex);
    const accentScale =
      accentHex === primaryHex
        ? primaryScale
        : accentHex === secondaryHex
          ? secondaryScale
          : generateScale(accentHex);

    const primaryKey = name;
    const secondaryKey =
      secondaryScale === primaryScale ? name : `${name}-secondary`;
    const accentKey =
      accentScale === primaryScale
        ? name
        : accentScale === secondaryScale
          ? secondaryKey
          : `${name}-accent`;

    const primaryRef = `color.${primaryKey}`;
    const secondaryRef = `color.${secondaryKey}`;
    const accentRef = `color.${accentKey}`;
    const origin = `brand-${name}`;

    console.log(`  ✓ ${primaryRef}: step 9 = ${primaryScale.anchor}`);
    if (secondaryScale !== primaryScale)
      console.log(`  ✓ ${secondaryRef}: step 9 = ${secondaryScale.anchor}`);
    if (accentScale !== primaryScale && accentScale !== secondaryScale)
      console.log(`  ✓ color.${accentKey}: step 9 = ${accentScale.anchor}`);

    const onPrimary = pickOnColor(primaryScale.anchor);
    const textSel = pickTextStep(primaryScale.lightSteps);
    const iconSel = pickIconStep(primaryScale.lightSteps);

    console.log("\nAuto-selected on-color:");
    console.log(
      `  on-primary: ${onPrimary.hex} (${onPrimary.ratio.toFixed(2)}:1` +
        ` on ${primaryScale.anchor}) ${onPrimary.passed ? "✓" : "⚠ below 4.5:1"}`,
    );
    console.log(
      `  brand text step: ${textSel.step} (${textSel.hex}) ${textSel.passed ? "✓" : "⚠ no step achieves 4.5:1 on white"}`,
    );
    if (!textSel.passed)
      console.warn(
        `  ⚠ Primary color is too light for accessible text on white.\n` +
          `    text.primary/text.title will use step ${textSel.step} (best available).\n` +
          `    Consider using a darker primary or adding contrast exemptions.`,
      );

    const onSecondaryRef = "{palette.secondary.12}";

    // 3. Create directory + package.json
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
        build: "npm run validate && npm run build:figma && npm run build:css && npm run build:preview",
      },
      dependencies: {
        culori: "^4.0.1",
        "nsp-ds-tokens": LIB_DEP,
      },
    });

    write(".gitignore", "node_modules/\nbuild/\ndist/\n");

    // 4. npm install — downloads nsp-ds-tokens from GitHub
    console.log(`\nRunning npm install (fetches nsp-ds-tokens ${LIB_VERSION} from GitHub)...`);
    try {
      execSync("npm install", { cwd: dest, stdio: "inherit" });
    } catch {
      console.error("✗ npm install failed — run it manually in the project directory.");
      process.exit(1);
    }

    // 5. Copy build + validate scripts from the installed library
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

    // 6. Write lib/ wrappers (re-export from nsp-ds-tokens, merge brand overlay)
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
    write(
      "scripts/lib/contrast.mjs",
      `export * from "nsp-ds-tokens/scripts/lib/contrast.mjs";\n`,
    );
    write(
      "scripts/lib/origin.mjs",
      `export * from "nsp-ds-tokens/scripts/lib/origin.mjs";\n`,
    );

    // 7. Token files
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
    if (accentScale !== primaryScale && accentScale !== secondaryScale)
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
        secondary: brandSlot(secondaryRef, origin),
        tertiary: mauveSlot(origin),
        accent: brandSlot(accentRef, origin),
      },
    });

    const ps = (n) => `{palette.primary.${n}}`;
    const ts = textSel.step;
    const th = Math.min(ts + 1, 12);
    const is_ = iconSel.step;
    const ih = Math.min(is_ + 1, 12);
    write("tokens/semantic/color.json", {
      surface: {
        "primary-xlight": ct(ps(3), ps(10)),
        "primary-light": ct(ps(8), ps(10)),
        primary: ct(ps(9), ps(9)),
        "primary-dark": ct(ps(10), ps(8)),
        "primary-hover": ct(ps(10), ps(8)),
        secondary: ct("{palette.secondary.3}", "{palette.secondary.3}"),
        "secondary-hover": ct("{palette.secondary.4}", "{palette.secondary.4}"),
        "secondary-active": ct("{palette.secondary.5}", "{palette.secondary.5}"),
        tertiary: ct("{palette.tertiary.3}", "{palette.tertiary.3}"),
        "tertiary-hover": ct("{palette.tertiary.4}", "{palette.tertiary.4}"),
        "tertiary-active": ct("{palette.tertiary.5}", "{palette.tertiary.5}"),
        "tertiary-dark": ct("{palette.neutral.11}", "{palette.neutral.12}"),
        "tertiary-darker": ct("{palette.neutral.12}", "{palette.neutral.11}"),
      },
      text: {
        title: ct(ps(ts), ps(12)),
        primary: ct(ps(ts), ps(12)),
        "primary-light": ct(ps(8), ps(8)),
        "primary-xlight": ct(ps(3), ps(3)),
        "primary-hover": ct(ps(th), ps(12)),
        "on-primary": ct(onPrimary.lightRef, onPrimary.darkRef),
        "on-secondary": ct(onSecondaryRef, onSecondaryRef),
        "on-tertiary": ct("{palette.tertiary.12}", "{palette.tertiary.12}"),
      },
      stroke: {
        primary: ct(ps(is_), ps(11)),
        hover: ct(ps(ih), ps(11)),
      },
      logo: {
        default: ct(ps(9), ps(8)),
      },
      icon: {
        primary: ct(ps(is_), ps(12)),
        "primary-light": ct(ps(8), ps(11)),
        "primary-hover": ct(ps(ih), ps(12)),
        secondary: ct("{palette.secondary.11}", "{palette.secondary.12}"),
        "on-primary": ct(onPrimary.lightRef, onPrimary.darkRef),
        "on-secondary": ct(onSecondaryRef, onSecondaryRef),
        "on-tertiary": ct("{palette.tertiary.12}", "{palette.tertiary.12}"),
      },
      "emphasis-brand": {
        default: ct(ps(8), ps(8)),
        dark: ct(ps(10), ps(10)),
      },
      emphasis: {
        default: ct("{palette.accent.default}", "{palette.accent.subtle}"),
        subtle: ct("{palette.accent.2}", "{palette.accent.4}"),
      },
    });

    // 8. CLAUDE.md
    const colorLines = [
      `- Primary (step 9): \`${primaryScale.anchor}\``,
      ...(secondaryScale !== primaryScale
        ? [`- Secondary (step 9): \`${secondaryScale.anchor}\``]
        : []),
      ...(accentScale !== primaryScale && accentScale !== secondaryScale
        ? [`- Accent (step 9): \`${accentScale.anchor}\``]
        : []),
      `- text.on-primary: \`${onPrimary.hex}\` (${onPrimary.ratio.toFixed(2)}:1 on primary.9)`,
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
  brand/${name}.json  ← palette slot aliases: primary, secondary, tertiary, accent
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

    // 9. Build + gate
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
        console.error(`\n⚠ Build failed: ${contrastLines.length} contrast issue(s).`);
        console.error("  Adjust palette slot steps in tokens/semantic/color.json,");
        console.error(
          "  or add exemptions to scripts/lib/contrast.mjs (CONTRAST_EXEMPT).",
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
