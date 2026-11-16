# mcp-dbs

A Model Context Protocol (MCP) server that lets MCP clients (Claude, Kiro, …) query your databases using the connection profiles you already have in your desktop database tools. You don't need to set up profiles by hand.

> **Status:** this project is moving from a PostgreSQL-only server to a multi-engine one. See [ROADMAP.md](ROADMAP.md).
>
> | | Today | Planned |
> |---|---|---|
> | Engines | PostgreSQL | SQL Server, DuckDB |
> | Profile sources | DBeaver | DBDelve |
> | Platforms | Linux, macOS, Windows (DBeaver found automatically) | |
> | Tunnels | none | SSH, AWS SSM |

## Prerequisites

- Node.js 20 or later
- DBeaver, with PostgreSQL connections configured and their passwords saved
- Linux, macOS or Windows

## Installation

```bash
npm install
```

## Configuration

Usually none. The server finds DBeaver's workspace by itself and reads the connections of **every project** in it (`General` and any others):

| OS | Where it looks |
|----|----------------|
| Windows | `%APPDATA%\DBeaverData\workspace6` |
| macOS | `~/Library/DBeaverData/workspace6` |
| Linux | `~/.local/share/DBeaverData/workspace6`, then Flatpak (`~/.var/app/io.dbeaver.DBeaverCommunity/data/DBeaverData/workspace6`), then Snap (`~/snap/dbeaver-ce/current/.local/share/DBeaverData/workspace6`). The first one with connections is used. |

Workspaces from DBeaver versions before 6.1.3, which keep the files in `workspace6/.metadata/.plugins/org.jkiss.dbeaver.core/`, are read too.

If DBeaver keeps its workspace somewhere else, set one of these:

| Variable | Meaning |
|----------|---------|
| `DBEAVER_WORKSPACE` | A DBeaver workspace folder (the one that holds `General/`). Every project in it is read. |
| `DBEAVER_DATA_SOURCES_JSON` | Exactly one `data-sources.json`. Nothing else is read. |
| `DBEAVER_CREDENTIALS_CONFIG_JSON` | The encrypted `credentials-config.json` that goes with it. Defaults to the one in the same folder. |

Paths may start with `~`. Forward slashes work on Windows too.

When running the server directly, you can put these in a `.env` file (copy `.env.example`). When an MCP client starts the server, put them in the client's `env` instead, because the client does not read `.env`.

If the server can't find DBeaver, it still starts. `status` and `list_profiles` say where it looked and what went wrong.

## Adding it to an MCP client

### Claude Code

```bash
claude mcp add dbs -- node /path/to/mcp_dbs/index.js
# with a workspace somewhere else:
claude mcp add dbs -e DBEAVER_WORKSPACE=/path/to/workspace6 -- node /path/to/mcp_dbs/index.js
```

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "dbs": {
      "command": "node",
      "args": ["/path/to/mcp_dbs/index.js"]
    }
  }
}
```

On Windows, write paths as `C:/path/to/mcp_dbs/index.js` or `C:\\path\\to\\mcp_dbs\\index.js` (JSON needs doubled backslashes). To set a variable, add `"env": { "DBEAVER_WORKSPACE": "..." }` next to `args`.

On macOS, Claude Desktop doesn't see the `PATH` from your shell. If `node` comes from nvm, Homebrew or similar, use its full path as `command` (run `which node` to find it).

### Kiro

The same JSON as for Claude Desktop, in `~/.kiro/settings/mcp.json` (for every workspace) or `.kiro/settings/mcp.json` (for one workspace).

## Usage

1. **List profiles:** "List all database profiles". Profile ids start with their source, e.g. `dbeaver:Production/orders-db` (`dbeaver:<folder>/<name>`, or `dbeaver:<name>` when the connection has no folder). Connections from a DBeaver project other than `General` also carry the project name: `dbeaver:<project>:<folder>/<name>`. An id without the `dbeaver:` prefix is also accepted when it matches only one profile.
2. **Connect:** "Connect to dbeaver:Production/orders-db"
3. **Query:** "Query: SELECT * FROM users LIMIT 10"

Connections that can't be used (no saved password, an engine not supported yet, an SSH tunnel) are listed under `skipped` with the reason.

**TLS** follows the connection's SSL tab in DBeaver (`sslMode`, CA certificate), or its `sslmode` driver property. When neither is set, TLS is off for `localhost` and for the `local`/`no_ssl` folders, and on (without checking the certificate) for everything else.

**Read-only** connections (DBeaver's "Read-only connection" setting) refuse `execute`, and their sessions are opened read-only on the server too.

## Tools

| Tool | Description |
|------|-------------|
| `list_profiles` | List the profiles (id, engine, source, tunnel, read-only), the skipped connections with reasons, and sources that failed to load. Optional `engine`/`source` filters |
| `connect` | Connect to a profile returned by `list_profiles`, closing any current connection |
| `query` | Run a SQL query and return the rows as JSON. Optional `max_rows` |
| `execute` | Run DDL/DML statements and return the number of affected rows. Refused on read-only profiles |
| `disconnect` | Close the current connection |
| `status` | Show the current profile, engine, server version and tunnel, and where each profile source was read from (or why it failed) |

## Development

```bash
npm test
```

## License

[MIT](LICENSE)
