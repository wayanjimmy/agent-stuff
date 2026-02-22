# Zread (via mcporter) — Quick Reference

## Tools

| Tool                 | Purpose                                            | Syntax                                                                            |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `search_doc`         | Semantic search across docs, code, issues, commits | `mcporter call zread.search_doc repo_name="owner/repo" query="..." language="en"` |
| `get_repo_structure` | Browse directory tree                              | `mcporter call zread.get_repo_structure repo_name="owner/repo" dir_path="/"`      |
| `read_file`          | Read full file contents                            | `mcporter call zread.read_file repo_name="owner/repo" file_path="path/to/file"`   |

## Parameters

### search_doc

| Parameter   | Required | Description                                  |
| ----------- | -------- | -------------------------------------------- |
| `repo_name` | yes      | GitHub repo in `owner/repo` format           |
| `query`     | yes      | Search keywords or question                  |
| `language`  | no       | `"zh"` or `"en"` (default: context language) |

### get_repo_structure

| Parameter   | Required | Description                         |
| ----------- | -------- | ----------------------------------- |
| `repo_name` | yes      | GitHub repo in `owner/repo` format  |
| `dir_path`  | no       | Directory to inspect (default: `/`) |

### read_file

| Parameter   | Required | Description                        |
| ----------- | -------- | ---------------------------------- |
| `repo_name` | yes      | GitHub repo in `owner/repo` format |
| `file_path` | yes      | Relative path to file              |

## Workflow

1. **Explore** — `get_repo_structure` to understand layout
2. **Search** — `search_doc` for concepts/patterns
3. **Read** — `read_file` for specific implementations (only when path is known)

## Examples

```bash
# Explore structure
mcporter call zread.get_repo_structure repo_name="ardanlabs/service" dir_path="foundation/logger"

# Search for patterns
mcporter call zread.search_doc repo_name="ardanlabs/service" query="logger middleware trace id" language="en"

# Read specific file
mcporter call zread.read_file repo_name="ardanlabs/service" file_path="foundation/logger/logger.go"
```

## Important

- All operations are read-only; no cloning needed.
- Results include source URLs for citation.
- Prefer `search_doc` over `read_file` — only read files when you have a specific path.
- For large files, pipe to workspace and slice: `mcporter call zread.read_file ... > /tmp/file.txt`
