# Changelog

## 2.0.0 (2026-11-16)

The PostgreSQL-only `mcp-postgresql` became `mcp-dbs`: more engines, a second profile source, tunnels, and all three desktop operating systems. Every decision and its reasons are in [docs/ADR.md](docs/ADR.md).

### Breaking changes

- **New name.** The package, its `bin` and the MCP server name are now `mcp-dbs`. Update the server entry in your MCP client config (ADR-1).
- **Profile ids start with their source**: `Production/orders-db` is now `dbeaver:Production/orders-db`, and DBDelve profiles are `dbdelve:<id>` (ADR-2). An id without the prefix still works when it matches only one profile (ADR-15). Connections from DBeaver projects other than `General` are `dbeaver:<project>:<folder>/<name>` (ADR-22).
- **`list_profiles` returns JSON** (`profiles`, `skipped` with reasons, `errors`) instead of one id per line (ADR-21).
- **Binary values** come back as `\x…` hex instead of `{"type":"Buffer","data":[…]}` (ADR-21).
- **DBeaver connections with an SSH tunnel** now go through the tunnel. Before, they connected straight to the database host. Tunnels that log in with a password, or go through jump servers, are skipped (ADR-11, ADR-45).
- **Read-only connections are enforced**: `execute` is refused, and on PostgreSQL the session itself is opened read-only (ADR-8, ADR-18).
- **TLS follows the connection's own settings** in DBeaver or DBDelve. The old rule (no TLS for `localhost` and the `local`/`no_ssl` folders, TLS without certificate checks otherwise) is now only the fallback for PostgreSQL connections that say nothing (ADR-17).

### New

- **Engines:** SQL Server (with `GO` batches, several result sets, named instances; ADR-28 to ADR-31) and DuckDB (local files, exact values, clear lock errors; ADR-33 to ADR-36).
- **DBDelve** as a second profile source, with passwords read from the OS password store only when you connect (ADR-3, ADR-27, ADR-37, ADR-38).
- **Tunnels:** SSH through the system `ssh` (keys and agent; passphrases through a narrow askpass helper) and AWS SSM port forwarding (ADR-41 to ADR-45).
- **Tools:** `disconnect`, `status`, `reload_profiles`; `engine`/`source` filters for `list_profiles`; `max_rows` for `query`.
- **Cross-platform:** DBeaver and DBDelve are found automatically on Linux (including Flatpak and Snap), macOS and Windows. New overrides: `DBEAVER_WORKSPACE`, `DBDELVE_VARIANT`, `DBDELVE_PROFILES`, `MCP_DBS_SSH_CONFIG`.
- **Logging** to stderr (`MCP_DBS_LOG`), with secrets redacted from errors.

### Fixed

- A dropped database connection no longer crashes the server.
- A missing or broken profile source no longer stops the server; it is reported in `status` and `list_profiles`.

## 1.0.0

`mcp-postgresql`: PostgreSQL through DBeaver profiles, with `list_profiles`, `connect`, `query` and `execute`.
