/**
 * sync_canvas.ts — Synchronize PDD Canvas with actual code
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/sync_canvas.ts 0001
 *   deno run --allow-read --allow-write scripts/sync_canvas.ts --dry-run 0001
 *   deno run --allow-read --allow-write scripts/sync_canvas.ts --all
 */

import { addEntity, exists, findProjectRoot, updateTaskStatus } from "./utils.ts";

// Parse arguments
const args = Deno.args;
const dryRun = args.includes("--dry-run");
const syncAll = args.includes("--all");
const canvasId = args.find((a) => !a.startsWith("--"));

if (!syncAll && !canvasId) {
  console.error("Usage: deno task sync [--dry-run] <canvas-id|all>");
  console.error("  Example: deno task sync 0001");
  console.error("  Example: deno task sync-dry 0001");
  console.error("  Example: deno task sync --all");
  Deno.exit(1);
}

// Interfaces
interface Entity {
  name: string;
  params: string;
  returnType: string;
  line: number;
}

interface Task {
  id: number;
  name: string;
  size: string;
  files: string;
  completed: boolean;
  line: number;
}

interface FileRef {
  path: string;
  exists: boolean;
  size?: number;
}

interface Canvas {
  id: string;
  title: string;
  entities: Entity[];
  tasks: Task[];
  files: FileRef[];
  raw: string;
}

// Find canvas files
async function findCanvases(projectRoot: string, id: string | undefined): Promise<string[]> {
  const pddDir = `${projectRoot}/.pdd`;

  if (id === "all") {
    const canvases: string[] = [];
    for await (const entry of Deno.readDir(pddDir)) {
      if (entry.name.match(/^\d{4}-.*\.md$/) && !entry.isDirectory) {
        canvases.push(`${pddDir}/${entry.name}`);
      }
    }
    return canvases;
  }

  const paddedId = id!.padStart(4, "0");
  for await (const entry of Deno.readDir(pddDir)) {
    if (entry.name.startsWith(paddedId)) {
      return [`${pddDir}/${entry.name}`];
    }
  }

  console.error(`Canvas not found: PDD-${paddedId}`);
  Deno.exit(1);
}

// Parse canvas file
async function parseCanvas(filePath: string): Promise<Canvas> {
  const content = await Deno.readTextFile(filePath);
  const lines = content.split("\n");

  const canvas: Canvas = {
    id: "",
    title: "",
    entities: [],
    tasks: [],
    files: [],
    raw: content,
  };

  let currentSection = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Extract title
    if (line.startsWith("# PDD-")) {
      canvas.title = line.replace(/^# PDD-\d+:\s*/, "");
      canvas.id = line.match(/PDD-(\d+)/)?.[1] || "";
    }

    // Track sections
    if (line.startsWith("## ")) {
      currentSection = line.replace("## ", "").trim();
    }

    // Collect entities
    if (currentSection.startsWith("E —") && line.startsWith("- `")) {
      const match = line.match(/- `(\w+)\(([^)]*)\):\s*([^`]+)`/);
      if (match) {
        canvas.entities.push({
          name: match[1],
          params: match[2],
          returnType: match[3],
          line: i + 1,
        });
      }
    }

    // Collect tasks (parse table rows)
    if (currentSection.startsWith("T —") && line.startsWith("|") && !line.startsWith("| #")) {
      const columns = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (columns.length >= 4 && columns[0].match(/^\d+$/)) {
        // Table format: | # | Task | Size | Dependencies | Files | Done |
        canvas.tasks.push({
          id: parseInt(columns[0]),
          name: columns[1],
          size: columns[2],
          files: columns[4] || "",
          completed: columns[5]?.includes("✓") || false,
          line: i + 1,
        });
      }
    }
  }

  // Collect file references from entire content
  const fileMatches = content.match(/`[^`]+\.(ts|js|go|py|rs|java|tsx|jsx)`/g);
  if (fileMatches) {
    const uniqueFiles = [...new Set(fileMatches.map((f) => f.replace(/`/g, "")))];
    canvas.files = uniqueFiles.map((f) => ({ path: f, exists: false }));
  }

  return canvas;
}

// Scan codebase for actual implementations
async function scanCodebase(projectRoot: string, canvas: Canvas) {
  const scanResults = {
    entities: [] as { name: string; params: string; returnType: string; file: string }[],
    files: [] as FileRef[],
  };

  // Scan for files referenced in canvas
  for (const fileRef of canvas.files) {
    const fullPath = `${projectRoot}/${fileRef.path}`;
    if (await exists(fullPath)) {
      const content = await Deno.readTextFile(fullPath);
      const lineCount = content.split("\n").length;

      // Extract method signatures (TypeScript/JavaScript specific)
      // For other languages, extend this regex or use AST parsing
      const methodMatches = content.match(/(\w+)\s*\(([^)]*)\)\s*:\s*([^{\n]+)/g);
      if (methodMatches) {
        for (const match of methodMatches) {
          const methodMatch = match.match(/(\w+)\s*\(([^)]*)\)\s*:\s*([^{\n]+)/);
          if (methodMatch) {
            scanResults.entities.push({
              name: methodMatch[1],
              params: methodMatch[2].trim(),
              returnType: methodMatch[3].trim(),
              file: fileRef.path,
            });
          }
        }
      }

      scanResults.files.push({
        path: fileRef.path,
        exists: true,
        size: lineCount,
      });
    } else {
      scanResults.files.push({
        path: fileRef.path,
        exists: false,
      });
    }
  }

  return scanResults;
}

// Compare and generate sync report
function compareAndSync(canvas: Canvas, scanResults: Awaited<ReturnType<typeof scanCodebase>>) {
  const changes: Array<{
    type: "task_completed" | "entity_added";
    task?: Task;
    method?: { name: string; params: string; returnType: string; file: string };
    description: string;
  }> = [];

  // Check tasks - mark completed if file exists
  for (const task of canvas.tasks) {
    if (task.files && !task.completed) {
      const filePaths = task.files.replace(/`/g, "").split(",").map((f) => f.trim());
      const allExist = filePaths.every((f) => {
        return scanResults.files.some((sf) => sf.path.includes(f) && sf.exists);
      });

      if (allExist) {
        changes.push({
          type: "task_completed",
          task: task,
          description: `Task "${task.name}" marked as completed (files exist)`,
        });
      }
    }
  }

  // Check entities - find new methods not in canvas
  const canvasMethods = canvas.entities.map((e) => e.name);
  const newMethods = scanResults.entities.filter((e) => !canvasMethods.includes(e.name));

  for (const method of newMethods) {
    changes.push({
      type: "entity_added",
      method: method,
      description: `New method found: ${method.name}() in ${method.file}`,
    });
  }

  return changes;
}

// Apply changes to canvas
async function applyChanges(
  canvasPath: string,
  changes: Awaited<ReturnType<typeof compareAndSync>>
): Promise<void> {
  let content = await Deno.readTextFile(canvasPath);

  for (const change of changes) {
    if (change.type === "task_completed" && change.task) {
      content = updateTaskStatus(content, change.task.line, true);
    }

    if (change.type === "entity_added" && change.method) {
      content = addEntity(content, change.method);
    }
  }

  await Deno.writeTextFile(canvasPath, content);
}

// Main
const projectRoot = await findProjectRoot();
console.log(`Project root: ${projectRoot}\n`);

const canvasFiles = await findCanvases(projectRoot, canvasId || "all");

for (const canvasFile of canvasFiles) {
  const canvas = await parseCanvas(canvasFile);
  console.log(`\nSyncing: PDD-${canvas.id} - ${canvas.title}`);
  console.log("─".repeat(50));

  // Scan codebase
  const scanResults = await scanCodebase(projectRoot, canvas);

  // Compare
  const changes = compareAndSync(canvas, scanResults);

  if (changes.length === 0) {
    console.log("✓ Canvas is in sync with code");
    continue;
  }

  console.log(`\nChanges detected (${changes.length}):`);
  for (const change of changes) {
    console.log(`  • ${change.description}`);
  }

  if (!dryRun) {
    await applyChanges(canvasFile, changes);
    console.log(`\n✓ Canvas updated: ${canvasFile}`);
  } else {
    console.log("\n→ Dry run: no changes written");
  }
}

console.log("\n✓ Sync complete");
