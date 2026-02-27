---
name: zread
description: Search GitHub repository knowledge and documentation using Zread MCP Server via mcporter. Use for learning patterns, reading code, and exploring repository structures without cloning.
---

# Zread MCP via McPorter

Access Zread MCP Server through mcporter to search and read GitHub repositories for knowledge extraction and code exploration.

## Prerequisites

- `mcporter` CLI installed (`npm install -g mcporter`)
- Z.AI API key for zread MCP server

### Setup

**1. Get your Z.AI API key**

- Visit https://into.md/docs.z.ai/devpack/mcp/zread-mcp-server to obtain an API key
- Or set the `ZAI_API_KEY` environment variable

**2. Configure zread in mcporter**

```bash
mcporter config add zread \
  --url https://api.z.ai/api/mcp/zread/mcp \
  --header "Authorization=Bearer $ZAI_API_KEY" \
  --scope home
```

This writes the configuration to `~/.mcporter/mcporter.json`:

```json
{
  "servers": {
    "zread": {
      "transport": "http",
      "url": "https://api.z.ai/api/mcp/zread/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

**3. Verify the setup**

```bash
mcporter list
mcporter list zread --schema
```

You should see:

```
- zread (3 tools)
```

**Troubleshooting**

- If `mcporter list` shows no servers, verify your API key is set
- Use `--dry-run` with `config add` to preview without writing
- Use `--scope project` to configure for the current project instead of home

## Usage

### 1. Search Repository Documentation

Search for concepts, patterns, or implementations within a repository:

```bash
mcporter call zread.search_doc repo_name="owner/repo" query="your search query" language="en"
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo_name` | string | yes | GitHub repository in `owner/repo` format (e.g., `ardanlabs/service`) |
| `query` | string | yes | Search keywords or question about the repository |
| `language` | string | no | `'zh'` or `'en'` (defaults to context language) |

**Example:**

```bash
mcporter call zread.search_doc repo_name="ardanlabs/service" query="logger pattern implementation" language="en"
```

### 2. Read File Contents

Read the full content of a specific file:

```bash
mcporter call zread.read_file repo_name="owner/repo" file_path="path/to/file.go"
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo_name` | string | yes | GitHub repository in `owner/repo` format |
| `file_path` | string | yes | Relative path to the file (e.g., `src/index.ts`) |

**Example:**

```bash
mcporter call zread.read_file repo_name="ardanlabs/service" file_path="foundation/logger/logger.go"
```

### 3. Get Repository Structure

Explore directory structure and file listings:

```bash
mcporter call zread.get_repo_structure repo_name="owner/repo" dir_path="/"
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo_name` | string | yes | GitHub repository in `owner/repo` format |
| `dir_path` | string | no | Directory path to inspect (default: root `/`) |

**Example:**

```bash
mcporter call zread.get_repo_structure repo_name="ardanlabs/service" dir_path="foundation/logger"
```

## Workflow Patterns

### Pattern 1: Explore → Search → Read

1. Get repository structure to understand layout
2. Search for specific concepts/patterns
3. Read relevant files for implementation details

```bash
# Step 1: Explore structure
mcporter call zread.get_repo_structure repo_name="owner/repo" dir_path="src"

# Step 2: Search for patterns
mcporter call zread.search_doc repo_name="owner/repo" query="middleware pattern implementation"

# Step 3: Read specific implementation
mcporter call zread.read_file repo_name="owner/repo" file_path="src/middleware/logger.ts"
```

### Pattern 2: Direct File Reading

When you know the file path, read directly:

```bash
mcporter call zread.read_file repo_name="golang/go" file_path="src/net/http/server.go"
```

## Available Tools Reference

List all tools with their schemas:

```bash
mcporter list zread --schema
```

**Zread provides 3 tools:**

1. `search_doc` - Semantic search across documentation, issues, and commits
2. `read_file` - Read full file contents
3. `get_repo_structure` - Browse directory structure

## When to Use

- **Learning patterns** from production repositories without cloning
- **Code review** of specific implementations
- **Architecture exploration** of unfamiliar codebases
- **Documentation research** for libraries and frameworks
- **Comparing implementations** across similar projects

## Best Practices

1. **Start broad, then narrow**: Use `search_doc` first, then `read_file` for specifics
2. **Use structured queries**: Be specific in search terms for better results
3. **Explore structure**: Use `get_repo_structure` to understand project layout
4. **Chain operations**: Combine multiple calls to build comprehensive understanding

## Example: Complete Exploration

```bash
# 1. Check what's available in the logger package
mcporter call zread.get_repo_structure repo_name="ardanlabs/service" dir_path="foundation/logger"

# 2. Search for logger patterns
mcporter call zread.search_doc repo_name="ardanlabs/service" query="logger middleware trace id" language="en"

# 3. Read the main logger implementation
mcporter call zread.read_file repo_name="ardanlabs/service" file_path="foundation/logger/logger.go"

# 4. Read the model definitions
mcporter call zread.read_file repo_name="ardanlabs/service" file_path="foundation/logger/model.go"

# 5. See how it's used in middleware
mcporter call zread.read_file repo_name="ardanlabs/service" file_path="app/sdk/mid/logging.go"
```

## Output Format

**Search results** include excerpts with source URLs and relevance rankings.

**File contents** are returned as raw text with GitHub source links.

**Directory structures** show tree-like listings of files and subdirectories.

## Important Notes

- All data is read-only; no repository cloning needed
- Results include source URLs for deeper exploration
- Response times vary based on repository size and query complexity
- No authentication required for public repositories
