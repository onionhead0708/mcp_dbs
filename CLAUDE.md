# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

mcp-dbs is a Model Context Protocol (MCP) server that gives MCP clients (e.g., Claude) database access. It exposes four tools: `list_profiles`, `connect`, `query` and `execute`. Profiles are loaded from DBeaver configuration files.

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

Today the whole server lives in `index.js`, using `@modelcontextprotocol/sdk` and `pg` (node-postgres). Phase 1 of the roadmap splits it into `src/` modules (profile sources, drivers, tunnels, session).

**Key concepts:**
- **Profiles:** Loaded the first time they are needed, from DBeaver's `data-sources.json` (filtered to `provider === "postgresql"`). Credentials are decrypted from `credentials-config.json` (AES-128-CBC). Profiles are stored in a `Map` keyed by `folder/name` (e.g. `Production/orders-db`). Connections without saved credentials are skipped. SSL is turned off for `localhost` and for the `local`/`no_ssl` folders. Every other connection uses `ssl: { rejectUnauthorized: false }`.
- **Connection state:** A single `pg.Client` is held in `currentClient`. Only one connection is active at a time; calling `connect` with a new profile disconnects the previous one.
- **Transport:** `StdioServerTransport`. Nothing may be written to stdout except MCP messages, which is why `console.log` is silenced and `.env` is parsed by hand.

**MCP tool registration pattern:** Tools are defined in the `ListToolsRequestSchema` handler. Tool calls are handled in a single `CallToolRequestSchema` handler that switches on `request.params.name`.
