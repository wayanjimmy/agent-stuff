---
name: laravel-boost
description: Access Laravel Boost MCP tools via mcporter for Laravel development tasks. Use for querying application info, database schema, routes, config, documentation search, tinker execution, and debugging.
---

# Laravel Boost MCP via MCPorter

Access Laravel Boost MCP through mcporter to interact with Laravel applications for development tasks, debugging, and code exploration.

## Prerequisites

- `mcporter` CLI installed (`npm install -g mcporter`)
- Laravel Boost MCP configured in mcporter (`php artisan boost:mcp`)
- Working Laravel application with Laravel Boost package installed

Verify laravel-boost is available:

```bash
mcporter list
```

## Configuration

Ensure Laravel Boost MCP is configured in your project's `config/mcporter.json`:

```json
{
  "mcpServers": {
    "laravel-boost": {
      "description": "Laravel Boost MCP - Laravel-specific tools for development",
      "command": "php",
      "args": ["../artisan", "boost:mcp"]
    }
  }
}
```

**Note:** MCPorter resolves paths relative to the config file's location. Since this config is in `config/mcporter.json`, the path to artisan (at project root) is `../artisan`.

## Quick Reference

| Tool                         | Purpose                                                       | Example                                                                    |
| ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `application-info`           | Get app info (PHP/Laravel versions, packages, models)         | `mcporter call laravel-boost.application-info`                             |
| `browser-logs`               | Read browser/JS logs for frontend debugging                   | `mcporter call laravel-boost.browser-logs entries:10`                      |
| `database-connections`       | List database connection names                                | `mcporter call laravel-boost.database-connections`                         |
| `database-query`             | Execute read-only SQL queries                                 | `mcporter call laravel-boost.database-query query:"SELECT * FROM users"`   |
| `database-schema`            | Read database schema (tables, columns, indexes, foreign keys) | `mcporter call laravel-boost.database-schema filter:users`                 |
| `get-absolute-url`           | Get absolute URL for path or named route                      | `mcporter call laravel-boost.get-absolute-url path:/dashboard`             |
| `get-config`                 | Get config value by key                                       | `mcporter call laravel-boost.get-config key:app.name`                      |
| `last-error`                 | Get last backend error/exception                              | `mcporter call laravel-boost.last-error`                                   |
| `list-artisan-commands`      | List all Artisan commands                                     | `mcporter call laravel-boost.list-artisan-commands`                        |
| `list-available-config-keys` | List all config keys                                          | `mcporter call laravel-boost.list-available-config-keys`                   |
| `list-available-env-vars`    | List env variables from .env                                  | `mcporter call laravel-boost.list-available-env-vars`                      |
| `list-routes`                | List all routes (incl. Folio)                                 | `mcporter call laravel-boost.list-routes path:blog`                        |
| `read-log-entries`           | Read last N app log entries                                   | `mcporter call laravel-boost.read-log-entries entries:20`                  |
| `search-docs`                | Search Laravel ecosystem docs                                 | `mcporter call 'laravel-boost.search-docs(queries: ["livewire", "volt"])'` |
| `tinker`                     | Execute PHP code in Laravel context                           | `mcporter call laravel-boost.tinker code:"User::count()"`                  |

## Usage

### MCPorter Syntax Options

**Flag style (shell-friendly):**

```bash
mcporter call laravel-boost.application-info
mcporter call laravel-boost.get-config key:app.name
mcporter call laravel-boost.database-query query:"SELECT COUNT(*) FROM users"
```

**Function-call style (better for complex args/arrays):**

```bash
mcporter call 'laravel-boost.search-docs(queries: ["livewire", "volt"], token_limit: 2000)'
mcporter call 'laravel-boost.database-query(query: "SELECT * FROM users LIMIT 10")'
```

**Shorthand (auto-infers `call`):**

```bash
mcporter laravel-boost.application-info
mcporter laravel-boost.list-routes method:GET
```

### 1. Application Information

Get comprehensive application info including PHP version, Laravel version, database engine, and installed packages:

```bash
mcporter call laravel-boost.application-info
```

**Response includes:**

- PHP version
- Laravel version
- Database engine (mysql, postgresql, sqlite, etc.)
- All installed packages with versions
- All Eloquent models in the application

### 2. Database Operations

#### Get Database Schema

```bash
# Get schema for all tables
mcporter call laravel-boost.database-schema

# Get schema for specific table
mcporter call laravel-boost.database-schema filter:users

# Get schema for specific database connection
mcporter call laravel-boost.database-schema database:tenant_main
```

#### Execute Read-Only Queries

```bash
mcporter call laravel-boost.database-query query:"SELECT * FROM users LIMIT 10"

mcporter call laravel-boost.database-query query:"SELECT COUNT(*) FROM posts"

mcporter call laravel-boost.database-query query:"SHOW TABLES"
```

#### List Database Connections

```bash
mcporter call laravel-boost.database-connections
```

### 3. Routes & URLs

#### List All Routes

```bash
# List all routes
mcporter call laravel-boost.list-routes

# Filter by path pattern
mcporter call laravel-boost.list-routes path:admin

# Filter by HTTP method
mcporter call laravel-boost.list-routes method:POST

# Filter by route name
mcporter call laravel-boost.list-routes name:dashboard

# Exclude vendor routes
mcporter call laravel-boost.list-routes except_vendor:true

# Only show vendor routes
mcporter call laravel-boost.list-routes only_vendor:true
```

#### Generate Absolute URLs

```bash
# For a path
mcporter call laravel-boost.get-absolute-url path:/dashboard

# For a named route
mcporter call laravel-boost.get-absolute-url route:home

# Default (returns "/")
mcporter call laravel-boost.get-absolute-url
```

### 4. Configuration & Environment

#### Get Config Value

```bash
mcporter call laravel-boost.get-config key:app.name
mcporter call laravel-boost.get-config key:database.default
mcporter call laravel-boost.get-config key:services.postmark.token
```

#### List Available Config Keys

```bash
mcporter call laravel-boost.list-available-config-keys
```

#### List Environment Variables

```bash
# From default .env file
mcporter call laravel-boost.list-available-env-vars

# From specific file
mcporter call laravel-boost.list-available-env-vars filename:.env.example
```

### 5. Documentation Search

Search Laravel ecosystem documentation (version-specific to your installed packages):

```bash
# Single query
mcporter call 'laravel-boost.search-docs(queries: ["rate limiting"])'

# Multiple queries (any match returns results)
mcporter call 'laravel-boost.search-docs(queries: ["middleware", "rate limiting", "throttling"])'

# Limit to specific packages
mcporter call 'laravel-boost.search-docs(queries: ["volt component"], packages: ["livewire/volt"])'

# Increase token limit for more complete results
mcporter call 'laravel-boost.search-docs(queries: ["livewire lifecycle"], token_limit: 5000)'
```

**Supported packages** (automatically detected from your app):

- Laravel Framework (10.x, 11.x, 12.x)
- Livewire (1.x, 2.x, 3.x, 4.x)
- Volt
- Filament (2.x, 3.x, 4.x, 5.x)
- Inertia (1.x, 2.x)
- Pest (3.x, 4.x)
- Nova (4.x, 5.x)
- Tailwind CSS (3.x, 4.x)
- And more Laravel ecosystem packages

### 6. Tinker (PHP Code Execution)

Execute PHP code in the Laravel application context:

```bash
# Simple expression
mcporter call laravel-boost.tinker code:"echo 'Hello World';"

# Query data
mcporter call laravel-boost.tinker code:"return User::count();"

# Test functions
mcporter call laravel-boost.tinker code:"return app()->environment();"

# Multi-line code
mcporter call laravel-boost.tinker code:'
$users = User::where("active", true)->limit(5)->get();
return $users->pluck("email");
'
```

**Important:**

- Use for debugging, testing code snippets, and checking if functions exist
- Prefer existing Artisan commands over custom tinker code
- Do not create models directly without explicit user approval
- Prefer Unit/Feature tests using factories for functionality testing

### 7. Debugging & Logs

#### Get Last Backend Error

```bash
mcporter call laravel-boost.last-error
```

#### Read Application Logs

```bash
# Read last 20 log entries (default)
mcporter call laravel-boost.read-log-entries entries:20

# Read last 50 log entries
mcporter call laravel-boost.read-log-entries entries:50
```

#### Read Browser Logs

```bash
# For frontend/JS debugging
mcporter call laravel-boost.browser-logs entries:10
```

### 8. Artisan Commands

#### List All Artisan Commands

```bash
mcporter call laravel-boost.list-artisan-commands
```

## Workflow Patterns

### Pattern 1: Database Schema Exploration

1. List database connections
2. Get schema for specific tables
3. Query data to understand relationships

```bash
# Step 1: Check connections
mcporter call laravel-boost.database-connections

# Step 2: Get user table schema
mcporter call laravel-boost.database-schema filter:users

# Step 3: Query sample data
mcporter call laravel-boost.database-query query:"SELECT * FROM users LIMIT 5"

# Step 4: Test relationships with tinker
mcporter call laravel-boost.tinker code:"return User::first()->posts;"
```

### Pattern 2: Route & URL Investigation

1. List routes matching a pattern
2. Get absolute URLs for testing
3. Check route config/middleware

```bash
# Step 1: Find admin routes
mcporter call laravel-boost.list-routes path:admin

# Step 2: Generate URL for named route
mcporter call laravel-boost.get-absolute-url route:admin.dashboard

# Step 3: Check config affecting routing
mcporter call laravel-boost.get-config key:app.url
```

### Pattern 3: Documentation-First Development

1. Search for version-specific documentation
2. Verify package versions
3. Apply recommended patterns

```bash
# Step 1: Check installed packages
mcporter call laravel-boost.application-info

# Step 2: Search for specific feature docs
mcporter call 'laravel-boost.search-docs(queries: ["livewire lifecycle", "mount method"])'

# Step 3: Test pattern with tinker
mcporter call laravel-boost.tinker code:"return (new class { use Livewire\Concerns\InteractsWithProperties; });"
```

### Pattern 4: Debugging

1. Check last backend error
2. Read application logs
3. Check browser logs for frontend issues
4. Use tinker to test hypotheses

```bash
# Step 1: Check last error
mcporter call laravel-boost.last-error

# Step 2: Read logs
mcporter call laravel-boost.read-log-entries entries:50

# Step 3: Check browser logs
mcporter call laravel-boost.browser-logs entries:20

# Step 4: Test code
mcporter call laravel-boost.tinker code:"return config('queue.default');"
```

### Pattern 5: Environment & Config Audit

1. List all available config keys
2. List all environment variables
3. Check specific config values
4. Verify environment-specific settings

```bash
# Step 1: List config keys
mcporter call laravel-boost.list-available-config-keys

# Step 2: List env vars
mcporter call laravel-boost.list-available-env-vars

# Step 3: Check key settings
mcporter call laravel-boost.get-config key:app.env
mcporter call laravel-boost.get-config key:database.connections.mysql.host

# Step 4: Verify application info
mcporter call laravel-boost.application-info
```

## Advanced Usage

### Function-Call Syntax for Complex Parameters

When using tools with object/array parameters, use the function-call syntax:

```bash
# Search with multiple queries and token limit
mcporter call 'laravel-boost.search-docs(queries: ["rate limiting", "throttling", "middleware"], token_limit: 5000)'

# Database query with specific connection
mcporter call 'laravel-boost.database-query(query: "SELECT * FROM users", database: "tenant_main")'

# List routes with multiple filters
mcporter call 'laravel-boost.list-routes(method: "POST", path: "api", except_vendor: true)'
```

## When to Use

- **Database Exploration**: Understanding schema, querying data without touching the database directly
- **Route Investigation**: Finding routes, generating URLs, understanding route structure
- **Config Debugging**: Checking config values, listing available keys, environment variables
- **Documentation Research**: Searching version-specific Laravel ecosystem documentation
- **Quick Testing**: Using tinker to test PHP snippets without creating files
- **Debugging**: Reading logs, checking errors, browser logs
- **Application Audit**: Getting comprehensive application info, package versions, models

## Best Practices

1. **Start with `application-info`**: Understand the Laravel version, database engine, and installed packages first
2. **Use `search-docs` before implementing**: Search for version-specific documentation before writing code
3. **Prefer `database-query` over direct DB access**: Use read-only queries instead of connecting to the database
4. **Use `tinker` for quick tests**: Test PHP snippets quickly without creating test files
5. **Check logs when debugging**: Use `read-log-entries`, `browser-logs`, and `last-error` together
6. **Use function-call syntax for arrays**: When passing arrays or multiple parameters, use the function-call syntax

## Output Format

**JSON responses** for most tools with structured data:

- `application-info`: Returns object with php_version, laravel_version, packages, models
- `database-schema`: Returns object with tables, columns, indexes, foreign_keys
- `database-query`: Returns query results as array of rows
- `get-config`: Returns object with key and value
- `search-docs`: Returns formatted documentation results with context

## Complete Example: New Feature Development

```bash
# 1. Understand the application
mcporter call laravel-boost.application-info

# 2. Search for relevant documentation
mcporter call 'laravel-boost.search-docs(queries: ["livewire forms", "validation"])'

# 3. Check database schema
mcporter call laravel-boost.database-schema filter:posts

# 4. List routes for the feature area
mcporter call laravel-boost.list-routes path:posts

# 5. Test code with tinker
mcporter call laravel-boost.tinker code:'
$post = \App\Models\Post::factory()->make();
return $post->toArray();
'

# 6. Verify URLs
mcporter call laravel-boost.get-absolute-url route:posts.index

# 7. Check config
mcporter call laravel-boost.get-config key:filesystems.default
```

## Important Notes

- All database queries are read-only (SELECT, SHOW, EXPLAIN, DESCRIBE)
- Tinker execution has a 180-second timeout by default
- Search docs returns version-specific results based on installed packages
- Logs are correctly handled for multi-line PSR-3 formatted logs
- Route listings include Folio routes when applicable
- All operations respect Laravel's configuration and environment
