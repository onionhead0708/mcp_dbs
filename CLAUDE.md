# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mcp-dbs is a Model Context Protocol (MCP) server that gives MCP clients (e.g., Claude) database access. It exposes six tools: `list_profiles`, `connect`, `query`, `execute`, `disconnect` and `status`. Profiles are loaded from DBeaver configuration files.

The project is being extended to SQL Server and DuckDB, to DBDelve as a second profile source, to SSH and AWS SSM tunnels, and to Linux, macOS and Windows. **`ROADMAP.md` is the plan and task list.** Check it before starting work, and tick off tasks as they are done.

**This is a public repo.** Never commit `.env`, real hostnames, connection or customer names, personal paths, or secrets (including in test fixtures).

## Environment

Requires a `.env` file (copy from `.env.example`) with two vars:
- `DBEAVER_DATA_SOURCES_JSON`: path to DBeaver's `data-sources.json`
- `DBEAVER_CREDENTIALS_CONFIG_JSON`: path to DBeaver's encrypted `credentials-config.json`

When the server is started by an MCP client, set these as `env` in the client config instead, because the client does not read `.env`.

## Build & Run

- **Install dependencies:** `npm install` (Node 20 or later)
- **Run the server:** `node index.js` (talks over stdio)
- **Tests:** `npm test` (`node:test`; files in `test/`, fixtures in `test/fixtures/`)
- No build step. The project is ES modules (`"type": "module"`).
- No linter is configured.

## Architecture

`index.js` only wires things up: it loads `.env`, builds the profile registry and the session, and starts the MCP server over stdio. The rest is in `src/` (layout in `ROADMAP.md` §4):

- `config.js`: `.env` loader (CRLF-safe, never overrides the real environment) and the DBeaver paths.
- `profiles/model.js`: `makeProfile()` builds and validates the shared profile shape; `describeProfile()` is what tools may show (never secrets).
- `profiles/registry.js`: merges sources, ids `<source>:<localId>`, caches, `reload()`. A source that throws is reported in `errors`, not fatal. Unusable connections go to `skipped` with a reason. `get()` also accepts an unprefixed id when it is unique.
- `profiles/sources/dbeaver.js`: decrypts `credentials-config.json` (AES-128-CBC, IV = first 16 bytes) and maps `data-sources.json`. Only Postgres so far; TLS comes from the `*_ssl` handler or the `sslmode` driver property (same order as DBDelve's importer).
- `secrets/index.js`: profiles hold secret *references*; `resolveSecret()` turns them into text only at `connect`. `InlineSecret` keeps the value in a private field so it never appears in JSON or `util.inspect`.
- `tunnels/index.js`: returns the endpoint to connect to (the profile's host/port until SSH/SSM land).
- `drivers/`: one module per engine implementing `connect(profile, endpoint, { password })`, `query`, `execute`, `serverVersion`, `close`. `drivers/postgres.js` maps TLS modes to node-postgres, keeps the old localhost/`local`/`no_ssl` rule as the fallback, sets `default_transaction_read_only` on read-only profiles, and listens for `error` so a dropped connection cannot crash the server.
- `session.js`: the single active connection (profile + driver handle + tunnel). `connect` closes the previous connection first. `execute` is refused on read-only profiles.
- `format.js`: makes rows JSON-safe (BigInt, Date, Buffer → `\x…` hex, decimals, Map/Set, cycles) and applies `max_rows`.
- `server.js`: tool definitions (`TOOLS`) and a handler per tool name (`createHandlers`, unit-tested without a database).

Nothing may be written to stdout except MCP messages, so `console.log` is redirected to stderr.
