/**
 * bootstrap_pdd.ts — Initialize PDD structure in a repo
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/bootstrap_pdd.ts
 */

import { exists, findProjectRoot } from "./utils.ts";

// Create directory structure
async function createDirectories(projectRoot: string): Promise<void> {
  const dirs = [".pdd", ".pdd/spikes"];

  for (const dir of dirs) {
    const fullPath = `${projectRoot}/${dir}`;
    if (!(await exists(fullPath))) {
      await Deno.mkdir(fullPath, { recursive: true });
      console.log(`  ✓ Created ${dir}/`);
    } else {
      console.log(`  → ${dir}/ already exists`);
    }
  }
}

// Create README index
async function createReadme(projectRoot: string): Promise<void> {
  const readmePath = `${projectRoot}/.pdd/README.md`;

  if (await exists(readmePath)) {
    console.log("  → .pdd/README.md already exists");
    return;
  }

  const content = `# PDD Canvases

This directory contains PDD (Prompt Driven Development) canvases and spike documents.

## Structure

\`\`\`
.pdd/
├── README.md              # This file
├── 0001-*.md             # Canvas files
├── 0002-*.md
└── spikes/
    ├── 0001-*-research.md  # Spike documents
    └── 0002-*-research.md
\`\`\`

## Canvas Status

| Status | Meaning |
|--------|---------|
| proposed | Under review |
| active | Implementation in progress |
| completed | Done and verified |
| superseded | Replaced by newer canvas |

## Creating New Documents

\`\`\`bash
# Create a new canvas
deno task new-canvas "Add rate limiting"

# Create a simple canvas
deno task new-canvas-simple "Fix login bug"

# Create a spike document
deno task new-spike "Evaluate JWT auth"

# Sync canvas with code
deno task sync 0001
\`\`\`

## Index

<!-- Update this table when adding new canvases -->

| ID | Title | Status | Date |
|----|-------|--------|------|
| | | | |
`;

  await Deno.writeTextFile(readmePath, content);
  console.log("  ✓ Created .pdd/README.md");
}

// Main
const projectRoot = await findProjectRoot();

console.log("Initializing PDD structure...");
console.log(`Project root: ${projectRoot}\n`);

await createDirectories(projectRoot);
await createReadme(projectRoot);

console.log("\n✓ PDD structure initialized!");
console.log("\nNext steps:");
console.log('  1. Create a spike: deno task new-spike "Your investigation"');
console.log('  2. Create a canvas: deno task new-canvas "Your decision"');
console.log("  3. Follow the PDD workflow in the skill");
