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

1. **List profiles:** "List all database profiles". Profiles are shown as `folder/name`, e.g. `Production/orders-db`.
2. **Connect:** "Connect to Production/orders-db"
3. **Query:** "Query: SELECT * FROM users LIMIT 10"

## Tools

| Tool | Description |
|------|-------------|
| `list_profiles` | List the PostgreSQL profiles loaded from DBeaver (`folder/name`) |
| `connect` | Connect to a profile returned by `list_profiles` |
| `query` | Run a SQL query and return the rows as JSON |
| `execute` | Run DDL/DML statements and return the number of affected rows |

## Development

```bash
npm test
```

## License

[MIT](LICENSE)
