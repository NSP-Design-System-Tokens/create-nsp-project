#!/usr/bin/env node
// Run whenever generate-scale.mjs changes in nsp-ds-tokens.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(__dirname, "..");
const sourceFile = resolve(
  cliRoot,
  "../nsp-ds-tokens/scripts/lib/generate-scale.mjs",
);
const targetFile = resolve(cliRoot, "index.mjs");

if (!existsSync(sourceFile)) {
  console.error(
    `\nERROR: source file not found:\n  ${sourceFile}\n\n` +
      `Required workspace layout:\n` +
      `  <workspace>/\n` +
      `    nsp-ds-tokens/          (library repo — sibling of create-nsp-project)\n` +
      `    create-nsp-project/     (this repo)\n\n` +
      `Clone or move nsp-ds-tokens so both repos share the same parent directory,\n` +
      `then re-run this script.\n`,
  );
  process.exit(1);
}

const raw = readFileSync(sourceFile, "utf8");
const transformed = raw
  .split("\n")
  .map((line) => line.replace(/^export /, ""))
  .join("\n")
  .trim();

const code = readFileSync(targetFile, "utf8");
const startMarker = "// @generated-start:generate-scale";
const endMarker = "// @generated-end:generate-scale";

const startIdx = code.indexOf(startMarker);
const endIdx = code.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error(
    `\nERROR: markers not found in ${targetFile}\n\n` +
      `Expected markers in index.mjs:\n` +
      `  ${startMarker}\n` +
      `  ${endMarker}\n`,
  );
  process.exit(1);
}

const before = code.slice(0, startIdx + startMarker.length);
const after = code.slice(endIdx);
const newCode = `${before}\n${transformed}\n${after}`;

writeFileSync(targetFile, newCode, "utf8");

const written = readFileSync(targetFile, "utf8");
const ws = written.indexOf(startMarker) + startMarker.length + 1;
const we = written.indexOf(endMarker) - 1;
const injected = written.slice(ws, we);

const sourceHash = createHash("sha256").update(transformed).digest("hex");
const targetHash = createHash("sha256").update(injected).digest("hex");

if (sourceHash !== targetHash) {
  console.error(`HASH MISMATCH: source ${sourceHash} ≠ written ${targetHash}`);
  process.exit(1);
}

console.log(
  `✓ index.mjs updated — generate-scale vendorized (hash: ${sourceHash.slice(0, 12)})`,
);
