# mcp-dbs

A Model Context Protocol (MCP) server that lets MCP clients (Claude, Kiro, …) query your databases using the connection profiles you already have in DBeaver and DBDelve. You don't need to set up profiles by hand.

> **Status:** this project is moving from a PostgreSQL-only server to a multi-engine one. See [ROADMAP.md](ROADMAP.md).
>
> | | Today | Planned |
> |---|---|---|
> | Engines | PostgreSQL, SQL Server, DuckDB | |
> | Profile sources | DBeaver, DBDelve | |
> | Platforms | Linux, macOS, Windows (DBeaver found automatically) | |
> | Tunnels | SSH, AWS SSM | |

## Prerequisites

- Node.js 20 or later
- DBeaver or DBDelve (or both), with PostgreSQL, SQL Server or DuckDB connections. In DBeaver, passwords must be saved. DBDelve keeps them in the OS password store, which is read when you connect.
- Linux, macOS or Windows

## Installation

```bash
npm install
```

## Configuration

Usually none. The server finds DBeaver and DBDelve by itself.

### DBeaver

The server reads the connections of **every project** in DBeaver's workspace (`General` and any others):

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

### DBDelve

The server reads DBDelve's `profiles.toml` from DBDelve's own folder:

| OS | Folder |
|----|--------|
| Windows | `%APPDATA%\dbdelve` |
| macOS | `~/Library/Application Support/dbdelve` |
| Linux | `$XDG_DATA_HOME/dbdelve`, or `~/.local/share/dbdelve` |

| Variable | Meaning |
|----------|---------|
| `DBDELVE_VARIANT` | Use DBDelve's `dbdelve-<variant>` folder and keychain entries, as DBDelve does. |
| `DBDELVE_PROFILES` | A `profiles.toml` somewhere else. Passwords still come from the variant's keychain entries. |

Passwords are read from the OS password store (Keychain on macOS, Secret Service such as GNOME Keyring or KWallet on Linux, Credential Manager on Windows) only when you `connect`, never when profiles are listed. On macOS, the first `connect` may ask whether `node` may read the item; choose **Always Allow**. If DBDelve has no saved password for a profile, the server connects with a blank password, as DBDelve does. If that fails, the error says where to save it.

Skipped, with the reason shown in `list_profiles`:
- profiles that use `password_command` (mcp-dbs never runs commands from a config file)
- profiles that use a Postgres `service` file
- profiles with SSH `run_as`
- engines other than PostgreSQL, SQL Server and DuckDB
- SSH tunnels with `run_as` (see above)

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

1. **List profiles:** "List all database profiles". Profile ids start with their source, e.g. `dbeaver:Production/orders-db` or `dbdelve:orders-db` (`dbeaver:<folder>/<name>`, or `dbeaver:<name>` when the connection has no folder). Connections from a DBeaver project other than `General` also carry the project name: `dbeaver:<project>:<folder>/<name>`. An id without the `dbeaver:`/`dbdelve:` prefix is also accepted when it matches only one profile.
2. **Connect:** "Connect to dbeaver:Production/orders-db"
3. **Query:** "Query: SELECT * FROM users LIMIT 10"

Connections that can't be used (no saved password, an engine not supported yet, an SSH tunnel that logs in with a password) are listed under `skipped` with the reason.

**TLS** follows the connection's SSL tab in DBeaver (`sslMode`, CA certificate), or its `sslmode` driver property. When neither is set, TLS is off for `localhost` and for the `local`/`no_ssl` folders, and on (without checking the certificate) for everything else.

**Read-only** connections (DBeaver's "Read-only connection" setting) refuse `execute`. On PostgreSQL the session is also opened read-only on the server. On SQL Server, `query` runs inside a transaction that is always rolled back.

### SQL Server

- Sign-in is with a SQL login (user name and password). Connections that use Windows, Kerberos or Azure AD sign-in are skipped for now, and so are the Sybase and jTDS drivers.
- `execute` splits the script into batches on `GO` lines, like SSMS and sqlcmd. `GO 5` runs the batch five times.
- `query` returns every result set. With more than one, you get an array of arrays.
- Everything runs on one connection, so `#temp` tables and `USE` carry over between calls.
- TLS follows the connection's `encrypt` and "Trust server certificate" settings. With neither set, the certificate is verified, as Microsoft's driver does.
- `host\INSTANCE` with no port finds a named instance through SQL Server Browser.
- DECIMAL and MONEY come back as JSON numbers, so very long values lose precision. `CAST` them to `varchar` if you need them exact.

### DuckDB

- DuckDB connections are local database files, opened read-write, or read-only when the connection is marked read-only.
- DuckDB lets only one program write to a file at a time. If DBDelve or DBeaver has it open, `connect` says so; disconnect there first. Use `disconnect` here when you're done, so the other program can open it again.
- A path that doesn't exist is refused rather than creating an empty database. In-memory DuckDB connections are skipped.
- Values are exact: big integers and decimals come back as strings, and timestamps keep their microseconds.
- DuckDB support is an optional native package, with prebuilt binaries for Linux, macOS and Windows on x64 and arm64. If it can't be installed, everything else still works.

## Tunnels

Connections that go through **SSH** (DBeaver and DBDelve) or **AWS SSM** (DBDelve) open their tunnel on `connect` and close it on `disconnect`. `status` shows the route, e.g. `ssh deploy@bastion -> db.internal:5432`.

**SSH**
- Uses the `ssh` installed on your system, so `~/.ssh/config`, ssh-agent and hardware keys work as they do in a terminal. On Windows that is the built-in OpenSSH.
- **Keys and ssh-agent only.** Tunnels that log in with a password are skipped, and so are DBeaver tunnels through jump servers.
- A key's passphrase comes from where the profile keeps it: DBDelve's keychain entry, or the tunnel's saved password in DBeaver. It reaches ssh through a small helper that answers passphrase prompts and nothing else. It never appears on a command line.
- **Host keys are never accepted for you.** If the bastion's key is unknown or has changed, `connect` tells you to run `ssh <host>` once in a terminal to check it.
- `MCP_DBS_SSH_CONFIG=/path/to/config` makes ssh use that config file instead of `~/.ssh/config`.

**AWS SSM**
- Needs the AWS CLI and the Session Manager plugin, either on the `PATH` or at the paths set in the DBDelve profile.
- Uses the profile's AWS profile and region. If your credentials have expired, the error tells you to sign in again (e.g. `aws sso login`).

Tunnel programs are stopped, along with anything they started, on `disconnect`, when you connect elsewhere, and when the server exits.

## Tools

| Tool | Description |
|------|-------------|
| `list_profiles` | List the profiles (id, engine, source, tunnel, read-only), the skipped connections with reasons, and sources that failed to load. Optional `engine`/`source` filters |
| `connect` | Connect to a profile returned by `list_profiles`, closing any current connection |
| `query` | Run a SQL query and return the rows as JSON. Optional `max_rows` |
| `execute` | Run DDL/DML statements and return the number of affected rows. Splits on `GO` for SQL Server. Refused on read-only profiles |
| `disconnect` | Close the current connection |
| `status` | Show the current profile, engine, server version and tunnel, and where each profile source was read from (or why it failed) |

## Development

```bash
npm test
```

The SSH tunnel integration test needs Docker:

```bash
mkdir -p /tmp/ssh-test && scripts/ssh-test-env.sh up /tmp/ssh-test
. /tmp/ssh-test/env.sh && npm test
scripts/ssh-test-env.sh down
```

The SQL Server integration test runs only when a server is given:

```bash
docker run -d --rm -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=Test-Passw0rd!' -p 51433:1433 mcr.microsoft.com/mssql/server:2022-latest
MSSQL_TEST_PORT=51433 MSSQL_TEST_PASSWORD='Test-Passw0rd!' npm test
```

## License

[MIT](LICENSE)
