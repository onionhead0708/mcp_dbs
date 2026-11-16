# mcp-dbs

A Model Context Protocol (MCP) server that lets MCP clients (Claude, Kiro, …) query your databases using the connection profiles you already have in your desktop database tools. You don't need to set up profiles by hand.

> **Status:** this project is moving from a PostgreSQL-only server to a multi-engine one. See [ROADMAP.md](ROADMAP.md).
>
> | | Today | Planned |
> |---|---|---|
> | Engines | PostgreSQL | SQL Server, DuckDB |
> | Profile sources | DBeaver | DBDelve |
> | Platforms | Windows, Linux, macOS (DBeaver paths must be set by hand) | Paths found automatically |
> | Tunnels | none | SSH, AWS SSM |

## Prerequisites

- Node.js 20 or later
- DBeaver, with PostgreSQL connections configured and their passwords saved

## Installation

```bash
npm install
```

## Configuration

The server needs to know where DBeaver keeps its files:

| Variable | File |
|----------|------|
| `DBEAVER_DATA_SOURCES_JSON` | DBeaver's `data-sources.json` |
| `DBEAVER_CREDENTIALS_CONFIG_JSON` | DBeaver's encrypted `credentials-config.json` |

The usual location of both files:

| OS | Folder |
|----|--------|
| Windows | `%APPDATA%\DBeaverData\workspace6\General\.dbeaver\` |
| macOS | `~/Library/DBeaverData/workspace6/General/.dbeaver/` |
| Linux | `~/.local/share/DBeaverData/workspace6/General/.dbeaver/` |

Older DBeaver versions keep them in `workspace6/.metadata/.plugins/org.jkiss.dbeaver.core/` instead.

When running the server directly, copy `.env.example` to `.env` and fill in the paths. When an MCP client starts the server, put the paths in the client's `env` instead, because the client does not read `.env`:

```json
{
  "mcpServers": {
    "dbs": {
      "command": "node",
      "args": ["<path-to-repo>/index.js"],
      "env": {
        "DBEAVER_DATA_SOURCES_JSON": "<path-to>/data-sources.json",
        "DBEAVER_CREDENTIALS_CONFIG_JSON": "<path-to>/credentials-config.json"
      }
    }
  }
}
```

Where this config goes for each client:

| Client | Config file |
|--------|-------------|
| Claude Desktop | `claude_desktop_config.json` |
| Claude Code | `~/.claude.json`, or `claude mcp add` |
| Kiro CLI | `~/.kiro/settings/mcp.json` |

## Usage

1. **List profiles:** "List all database profiles". Profile ids start with their source, e.g. `dbeaver:Production/orders-db` (`dbeaver:<folder>/<name>`, or `dbeaver:<name>` when the connection has no folder). An id without the `dbeaver:` prefix is also accepted when it matches only one profile.
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
| `status` | Show the current profile, engine, server version and tunnel |

## Development

```bash
npm test
```

## License

[MIT](LICENSE)
