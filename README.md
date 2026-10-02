# jimbopi

Pi extensions and skills. Tested against **Pi 1.0.0**.

## Install

```sh
pi install git:github.com/wayanjimmy/agent-stuff
```

Requires Node.js 22.19+ and a current Pi installation. Pi supplies its core packages and TypeBox; this package installs Undici for proxy-aware HTTP requests.

### Extensions

- `prev-session`: `/prev` fills the editor with a prompt to read the preceding session through `xurl`. TUI only; requires `xurl` and its skill to be installed separately.
- `titlebar-spinner`: animates the TUI terminal title until the agent fully settles, including retries and queued continuations.
- `web-search`: Tavily `web_search`, `web_extract`, and `web_crawl`. Requires `TAVILY_API_KEY`; honors `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`. Keep real credentials out of committed files. Transport/API failures are reported as tool errors, not empty successful results.
- `whimsical`: randomized working messages.

### Skills

- `agy-cli`: requires the Antigravity CLI; optionally integrates with Herdr.
- `sourcegraph`: requires Deno and network access to sourcegraph.com.

Use `pi config` to disable resources you do not need.

### Project MCP

`.pi/mcp.json` uses Pi's built-in MCP support; no `pi-mcp-adapter` package is needed. The local `pgr` server uses `exposure: "codemode"` to make its four tools callable from Pi's built-in codemode. Install `pgr` separately and run `pi mcp list` to verify the connection.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run fmt:check
npm pack --dry-run
```

Tests are scoped to `test/`, use real Pi/TypeBox/TUI modules, and include a Pi-loader smoke test. Test requests use local fixtures, not live Tavily calls. Development Pi versions are pinned while published peers remain `*`, as recommended by Pi's package documentation. Update the development versions together and rerun these checks when upgrading Pi.

`npm run fmt` formats package configuration, extensions, and tests. The npm tarball only ships extensions, skills, this README, the license, and package metadata—not local `.pi` configuration or tests.
