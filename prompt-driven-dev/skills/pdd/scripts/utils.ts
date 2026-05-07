/**
 * utils.ts — Shared utilities for PDD scripts
 */

// Check if file/directory exists
export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// Find project root (look for .pdd, package.json, go.mod, or Cargo.toml)
export async function findProjectRoot(): Promise<string> {
  let dir = Deno.cwd();
  while (dir !== "/") {
    const hasPdd = await exists(`${dir}/.pdd`);
    const hasPackage = await exists(`${dir}/package.json`);
    const hasGoMod = await exists(`${dir}/go.mod`);
    const hasCargo = await exists(`${dir}/Cargo.toml`);

    if (hasPdd || hasPackage || hasGoMod || hasCargo) {
      return dir;
    }

    dir = dir.substring(0, dir.lastIndexOf("/"));
  }
  return Deno.cwd();
}

// Read template file
export async function readTemplate(filename: string): Promise<string> {
  const scriptDir = new URL(import.meta.url).pathname;
  const templatePath = `${scriptDir}/../assets/templates/${filename}`;
  return await Deno.readTextFile(templatePath);
}

// Generate filename from title
export function filenameFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Parse YAML front matter from markdown
export function parseFrontMatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex !== -1) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

// Update task status in canvas content
export function updateTaskStatus(
  content: string,
  taskLine: number,
  completed: boolean
): string {
  const lines = content.split("\n");
  const lineIndex = taskLine - 1;

  if (lineIndex >= 0 && lineIndex < lines.length) {
    const line = lines[lineIndex];
    const columns = line.split("|");

    // Find or add Done column
    // Table format: | # | Task | Size | Dependencies | Files | Done |
    if (columns.length >= 6) {
      // Has Done column already
      columns[5] = completed ? " ✓ " : " ";
    } else if (columns.length >= 5) {
      // Add Done column
      columns.splice(5, 0, completed ? " ✓ " : " ");
    }

    lines[lineIndex] = columns.join("|");
  }

  return lines.join("\n");
}

// Add entity to canvas content
export function addEntity(
  content: string,
  method: { name: string; params: string; returnType: string }
): string {
  const lines = content.split("\n");

  // Find Entities section
  const entitiesIndex = lines.findIndex((l) => l.startsWith("## E —"));
  if (entitiesIndex === -1) return content;

  // Find end of section
  let endIndex = lines.findIndex((l, i) => i > entitiesIndex && l.startsWith("## "));
  if (endIndex === -1) endIndex = lines.length;

  // Find last entity method
  let lastMethodIndex = entitiesIndex;
  for (let i = entitiesIndex; i < endIndex; i++) {
    if (lines[i].startsWith("- `")) {
      lastMethodIndex = i;
    }
  }

  // Insert new method
  const newLine = `- \`${method.name}(${method.params}): ${method.returnType}\` ← SYNCED`;
  lines.splice(lastMethodIndex + 1, 0, newLine);

  return lines.join("\n");
}
