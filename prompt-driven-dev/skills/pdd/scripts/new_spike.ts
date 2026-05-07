/**
 * new_spike.ts — Create a new PDD Spike Document
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/new_spike.ts "Evaluate JWT authentication"
 *   deno run --allow-read --allow-write scripts/new_spike.ts --canvas 0001 "Rate limiting research"
 */

import {
  exists,
  filenameFromTitle,
  findProjectRoot,
  readTemplate,
} from "./utils.ts";

// Parse arguments
const args = Deno.args;
const canvasIndex = args.indexOf("--canvas");
const canvasRef = canvasIndex !== -1 ? args[canvasIndex + 1] : null;
const title = args.filter((a, i) => !a.startsWith("--") && i !== canvasIndex + 1).join(" ");

if (!title) {
  console.error('Usage: deno task new-spike [--canvas NNNN] "Spike Title"');
  Deno.exit(1);
}

// Get next spike number
async function getNextNumber(projectRoot: string): Promise<number> {
  const spikesDir = `${projectRoot}/.pdd/spikes`;
  if (!(await exists(spikesDir))) {
    return 1;
  }

  const files: number[] = [];
  for await (const entry of Deno.readDir(spikesDir)) {
    const match = entry.name.match(/^(\d{4})-/);
    if (match) {
      files.push(parseInt(match[1], 10));
    }
  }

  return files.length > 0 ? Math.max(...files) + 1 : 1;
}

// Main
const projectRoot = await findProjectRoot();
const number = await getNextNumber(projectRoot);
const paddedNum = String(number).padStart(4, "0");
const filename = filenameFromTitle(title);
const outputFile = `${projectRoot}/.pdd/spikes/${paddedNum}-${filename}.md`;

// Create directory if needed
const dir = `${projectRoot}/.pdd/spikes`;
if (!(await exists(dir))) {
  await Deno.mkdir(dir, { recursive: true });
}

// Check if file exists
if (await exists(outputFile)) {
  console.error(`File already exists: ${outputFile}`);
  Deno.exit(1);
}

// Read template from file
const template = await readTemplate("pdd-spike.md");

// Replace placeholders
const date = new Date().toISOString().split("T")[0];
const content = template
  .replace(/{NNNN}/g, paddedNum)
  .replace(/{title}/g, title)
  .replace(/{date}/g, date)
  .replace(/{canvasRef}/g, canvasRef ? `canvas: PDD-${canvasRef}` : "");

// Write file
await Deno.writeTextFile(outputFile, content);

console.log(`✓ Created spike: ${outputFile}`);
console.log(`  Number: ${paddedNum}`);
if (canvasRef) {
  console.log(`  Canvas: PDD-${canvasRef}`);
}
