/**
 * new_canvas.ts — Create a new PDD Canvas
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/new_canvas.ts "Add rate limiting to API"
 *   deno run --allow-read --allow-write scripts/new_canvas.ts --simple "Fix login bug"
 */

import {
  exists,
  filenameFromTitle,
  findProjectRoot,
  readTemplate,
} from "./utils.ts";

// Parse arguments
const args = Deno.args;
const isSimple = args.includes("--simple");
const title = args.filter((a) => !a.startsWith("--")).join(" ");

if (!title) {
  console.error('Usage: deno task new-canvas [--simple] "Canvas Title"');
  Deno.exit(1);
}

// Get next canvas number
async function getNextNumber(projectRoot: string): Promise<number> {
  const pddDir = `${projectRoot}/.pdd`;
  if (!(await exists(pddDir))) {
    return 1;
  }

  const files: number[] = [];
  for await (const entry of Deno.readDir(pddDir)) {
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
const outputFile = `${projectRoot}/.pdd/${paddedNum}-${filename}.md`;

// Create directory if needed
const dir = `${projectRoot}/.pdd`;
if (!(await exists(dir))) {
  await Deno.mkdir(dir, { recursive: true });
}

// Check if file exists
if (await exists(outputFile)) {
  console.error(`File already exists: ${outputFile}`);
  Deno.exit(1);
}

// Read template from file
const templateName = isSimple ? "pdd-simple.md" : "pdd-canvas.md";
const template = await readTemplate(templateName);

// Replace placeholders
const date = new Date().toISOString().split("T")[0];
const content = template
  .replace(/{NNNN}/g, paddedNum)
  .replace(/{title}/g, title)
  .replace(/{date}/g, date);

// Write file
await Deno.writeTextFile(outputFile, content);

console.log(`✓ Created canvas: ${outputFile}`);
console.log(`  Number: PDD-${paddedNum}`);
console.log(`  Type: ${isSimple ? "Simple" : "Full"}`);
