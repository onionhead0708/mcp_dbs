# Roadmap: `mcp-dbs`: a multi-engine, multi-source, cross-platform MCP server

Status: **Phases 0–2 done (2026-11-16; CI green on Linux, macOS and Windows). T5.5 keychain spike: Linux and macOS passed, Windows unchecked. Phase 3 (SQL Server) done except T3.8, which moved to Phase 5.** Decisions are in §2.

## 1. Goals

| # | Goal | Today |
|---|------|-------|
| G1 | Connect to **PostgreSQL, Microsoft SQL Server and DuckDB** (read and write) | PostgreSQL only (`pg`) |
| G2 | Load profiles from **DBeaver and DBDelve** | DBeaver only, from two paths set in env vars |
| G3 | Run on **Linux, macOS and Windows** | Written and documented for Windows only |
| G4 | Reach databases through **SSH tunnels and AWS SSM** | Not supported |
| G5 | Rename the project to **`mcp-dbs`** | `mcp-postgresql` |

Out of scope for now, but the design must not block them: MySQL/MariaDB, SQLite, and Azure Entra sign-in for SQL Server.

## 2. Decisions (agreed 2026-11-16)

The reasons and consequences for each decision, plus the decisions made while building (ADR-15 onwards), are in [`docs/ADR.md`](docs/ADR.md). Record new decisions there.

| # | Decision |
|---|----------|
| D1 | Rename to `mcp-dbs`: the package name, `bin`, the MCP server name, and the docs. Renaming the repo or folder is optional and up to you. |
| D2 | Profile ids start with their source: `dbeaver:<folder/name>` and `dbdelve:<name>`. |
| D3 | DBDelve passwords and SSH passphrases are read from the **OS password store**. **`password_command` is never run**, and profiles that use it are skipped with a reason. There is no env-var or headless fallback: a desktop session is assumed. |
| D4 | SSH tunnels and AWS SSM tunnels are **in scope**. |
| D5 | SQL Server sign-in uses a username and password only, behind an **auth-strategy interface** so Entra can be added later without reworking the driver. |
| D6 | `execute` on SQL Server splits batches on `GO`. |
| D7 | DuckDB means local files, opened **read-write**. Read-only only when the profile is marked read-only. |
| D8 | Keep the `execute` tool (currently uncommitted) and block it on read-only profiles. |
| D9 | MySQL and SQLite come later, so the driver layer stays generic. |
| D10 | DuckDB connections are read from **both** DBeaver and DBDelve. |
| D11 | DBeaver SSH tunnels log in with **keys only**. A DBeaver tunnel set to password login is skipped with a reason. |
| D12 | The work happens in a **new folder `../mcp_dbs`** with a **new GitHub repo** (`mcp_dbs`). `mcp_postgresql` is left as it is. |
| D13 | The `mcp_dbs` GitHub repo is **public**, under your personal account. Nothing personal can be committed: no `.env`, no real hostnames or user paths, no internal connection names (e.g. the example connection names in the README and CLAUDE.md), and no secrets in fixtures. |
| D14 | On Linux, assume **one DBeaver installation**. The first workspace with connections (native, Flatpak, Snap) is used; they are not merged (ADR-23). |

## 3. Findings

### 3.1 Current code
- Everything lives in `index.js` (~260 lines): the `.env` loader, the DBeaver loader, the MCP handlers, and a single `pg.Client`.
- Uncommitted changes in the working tree: the `execute` tool, an SSL rule (no SSL for `localhost` or the `local`/`no_ssl` folders), and CRLF→LF line endings in `.gitignore`.
- The DBeaver loader keeps only `provider === "postgresql"`.
- `dotenv` is still listed as a dependency but is no longer used. There are no tests, no linter and no CI.

### 3.2 DBeaver (`data-sources.json`), checked against your sample
| Item | What the sample shows |
|------|---------------|
| SQL Server | `provider: "sqlserver"`, `driver: "microsoft"`, `configuration.host/port/database`, `auth-model: "sqlserver_database"` (= SQL login) |
| SQL Server TLS | `configuration.provider-properties.sslTrustServerCertificate`. `encrypt` and `trustServerCertificate` may also appear under `configuration.properties` |
| No folder | `folder` is missing, so the id is `dbeaver:<name>` (e.g. `dbeaver:local-sqlserver`) |
| Other auth-models | Any `auth-model` other than `sqlserver_database` (NTLM, Kerberos, AD) is skipped with a reason, to be picked up when Entra arrives |
| SQLite | `provider: "sqlite"`. Ignored for now (D9) |
| DuckDB | `provider: "duckdb"`, `driver: "duckdb_jdbc"`. The file is in `configuration.database`, with `configuration.url` = `jdbc:duckdb:<path>` as a fallback. There are **no credentials**, so the "skip when there is no user/password" rule in today's loader must not apply to DuckDB. The default name contains `/` (`DuckDB@/Users/…/test.duckdb`), so ids must not be split on `/`. |
| SSH tunnel | `configuration.handlers.ssh_tunnel.{enabled, properties}`. The login is in `credentials-config.json` under `"network/ssh_tunnel"` (user/password, or a key with its passphrase) |
| SSL (Postgres) | `configuration.handlers.postgre_ssl.properties.sslMode`, or `configuration.properties.sslmode` |
| Read-only | `configuration["read-only"]`. `connection-types` also has `confirm-data-change`, but that is ignored |
| Templates | When `original-provider`/`original-driver` are present, they take priority over `provider`/`driver` |
| AWS SSM | Not available in DBeaver Community, so DBDelve is the only source for it |

DBDelve's own DBeaver importer (`src/import/dbeaver.rs`) is a useful reference for these mappings, especially SSL and SSH.

### 3.3 DBDelve, checked against your sample and the DBDelve source
| Item | Details |
|------|---------|
| Profiles file | `<data_root>/dbdelve/profiles.toml`. Profiles are listed under `[[profiles]]`. Other top-level tables (`fonts`, `settings`) are ignored |
| `data_root` | Linux: `$XDG_DATA_HOME`, otherwise `~/.local/share`. macOS: `~/Library/Application Support`. Windows: `%APPDATA%` |
| Variant | When `DBDELVE_VARIANT=x` is set, both the folder and the keychain service become `dbdelve-x` |
| `engine` | `"mssql"` / `"duckdb"` / `"postgres"`. **Missing means `postgres`.** It can also be a table, `engine = { ssm = { engine = "…" } }`, which means the connection goes through SSM |
| Missing port | The sample `mssql` profile has no `port`, so use the default (1433 for SQL Server, 5432 for Postgres) |
| Empty `database` | Means the login's default database. Don't pass a database name to the driver |
| DuckDB | `path = "/…/test.duckdb"`. `host`, `user` and `database` are empty |
| `mode` | `read-only` / `read-write` / `full`. Only `read-only` blocks `execute` |
| `sslmode` | Uses libpq names (`disable`, `prefer`, `require`, `verify-ca`, `verify-full`), plus `root_certificate` (a file path) |
| `schema` | Optional default schema: the `search_path` on Postgres, `USE` on DuckDB |
| Password | Keychain service `dbdelve`, account = the profile `id` |
| SSH | `[profiles.ssh]` has `host`, `port`, `user` and `identity_file`. It uses **key or agent only**, and DBDelve runs **the system `ssh`**, so `~/.ssh/config` is honoured. The key's passphrase is in the keychain under service `dbdelve/ssh-passphrase`, account = id. `run_as` (Unix socket through sudo/socat) → **skip** |
| SSM | `[profiles.ssm]` has `target` (`i-…`/`mi-…`) and optionally `profile`, `region`, `aws_cli` and `session_manager_plugin`. DBDelve runs `aws ssm start-session --document-name AWS-StartPortForwardingSessionToRemoteHost` |
| `password_command` | Present → skip the profile (D3) |

To read the keychain from Node: **`@napi-rs/keyring`**. It binds the same Rust `keyring` crate that DBDelve uses and ships prebuilt binaries for all three operating systems.

## 4. Target architecture

```
index.js                        MCP wiring only
src/
  config.js                     .env (optional overrides), OS default paths
  profiles/
    model.js                    shared Profile shape and validation
    registry.js                 merges sources, ids, cache, reload, skip reasons
    sources/dbeaver.js          data-sources.json + credentials-config.json (one or more projects)
    sources/dbdelve.js          profiles.toml + keychain
  secrets/keychain.js           @napi-rs/keyring wrapper, read lazily when connecting
  tunnels/
    index.js                    open(profile) -> { localHost, localPort, close() }
    ssh.js                      system `ssh -N -L` (+ askpass helper for secrets)
    ssm.js                      `aws ssm start-session` port forwarding
  drivers/
    index.js                    engine -> driver
    postgres.js                 pg
    mssql.js                    mssql (tedious) + auth strategies
    mssql-auth.js               { sql } now; { entra-* } later
    duckdb.js                   @duckdb/node-api
  sql/split-go.js               splits batches on GO for SQL Server
  session.js                    active connection + tunnel lifecycle
  format.js                     rows -> JSON (BigInt, Date, Buffer, Decimal, nested)
```

**Profile model**

```js
{
  id: "dbdelve:local-sqlserver", source: "dbeaver" | "dbdelve",
  engine: "postgres" | "mssql" | "duckdb",
  name, folder,
  host, port, database,                      // server engines
  path,                                      // duckdb
  auth: { type: "password", user, secretRef },   // the secret is fetched when connect runs
  tls: { mode, rootCert, trustServerCert },
  tunnel: null | { type: "ssh", host, port, user, identityFile, secretRef }
               | { type: "ssm", target, awsProfile, region, awsCli, pluginPath },
  schema, readOnly,
}
```

**Driver interface**: `connect(profile, endpoint) → handle`, `query(handle, sql)`, `execute(handle, sql)`, `close(handle)`. `endpoint` is the profile's host and port, or the local end of the tunnel when there is one.

**MCP tools**
- `list_profiles`: shows id, engine, source and tunnel. Optional `engine`/`source` filters. Skipped profiles are listed with the reason.
- `connect(profile_id)`: opens the tunnel first if there is one, then the driver.
- `query(sql)`, `execute(sql)`: `execute` is refused on read-only profiles and splits on `GO` for SQL Server.
- `disconnect`: closes the driver and the tunnel. This matters for DuckDB, because the file stays locked while it is open.
- `status`: shows the current profile, engine, server version and tunnel.
- `reload_profiles`: reads the profile sources again without restarting the server.

## 5. Tasks

### Phase 0: Housekeeping and the new repo
- [x] T0.1 In `mcp_postgresql`: commit the pending `execute`, SSL and `.gitignore` changes (D8), and commit this roadmap.
- [x] T0.2 Create `../mcp_dbs` as a **new repo with fresh history**. Copy in the tracked files from `mcp_postgresql`, except `docs/superpowers/` (old planning notes full of private details), and make one initial commit. The old history stays in `mcp_postgresql` (D12, D13).
- [x] T0.3 **Before the first push**, remove private details from the files themselves:
  - customer and connection names used as examples in the README, CLAUDE.md and `index.js` comments
  - personal user paths (`C:/Users/<you>/...`, `/Users/<you>/...`)
  - make sure `.env` is not committed

  Set the commit author email for this repo (Q-E).

  The history scan on 2026-11-16 found no passwords or real hostnames. It found the work email in the commit authors, customer names in the README, CLAUDE.md and `docs/superpowers/`, and personal paths in `docs/superpowers/`. That is why the history starts fresh.
- [x] T0.3a Add a `LICENSE` (e.g. MIT) so the public repo can be used, then run `gh repo create mcp_dbs --public --source . --push` and set it as `origin`.
- [x] T0.4 Copy `.env` across by hand if you need it (it is not tracked by git). Move `ROADMAP.md` over; from then on all work happens in `mcp_dbs`. *(`.env` was not copied: either copy it yourself or set the paths in your MCP client config.)*
- [x] T0.5 Rename to `mcp-dbs`: the `package.json` name and bin, the server name in `new Server(...)`, the README, CLAUDE.md and the client config examples (D1).
- [x] T0.6 Remove `dotenv` and add `"engines": { "node": ">=20" }`.
- [x] T0.7 Set up tests with `node:test`, and a `test/fixtures/` folder holding: an encrypted DBeaver config (made from your sample with fake secrets), a DBDelve `profiles.toml` (from your sample), with personal paths and user names in both replaced by placeholders, and a DuckDB file generated by the tests. *(Done: `test/smoke.test.js`; the encrypted fixture is regenerated with `scripts/make-dbeaver-credentials.js`. The DuckDB file comes in Phase 4.)*

### Phase 1: Refactor (Postgres only, behaviour unchanged)
- [x] T1.1 Split `index.js` into the modules above.
- [x] T1.2 Add the profile model and the registry. The DBeaver source returns profiles with the `dbeaver:` prefix (D2).
- [x] T1.3 Add the driver interface and move the `pg` code into `drivers/postgres.js`.
- [x] T1.4 Take TLS from the profile (`postgre_ssl` handler, `sslmode`). Keep the localhost/folder rule only as a fallback.
- [x] T1.5 Add `format.js` for JSON-safe output, plus an optional `max_rows` argument for `query`.
- [x] T1.6 Add the `disconnect` and `status` tools. Enforce read-only on `execute` (D8).
- [x] T1.7 Unit tests for the DBeaver source, the registry and the formatting.

  *Phase 1 notes:* `src/server.js` holds the tools (index.js is wiring only). The `list_profiles` `engine`/`source` filters and skip reasons from T7.1 are already in; `reload_profiles` is not. DBeaver connections with an enabled non-SSL network handler (e.g. SSH) are skipped until Phase 6. Read-only Postgres sessions also run with `default_transaction_read_only = on`. `list_profiles` now returns JSON instead of one id per line.

### Phase 2: Cross-platform
- [x] T2.1 Auto-detect the DBeaver workspace when the env vars are not set:
  - Windows: `%APPDATA%\DBeaverData\workspace6`
  - macOS: `~/Library/DBeaverData/workspace6`
  - Linux: `~/.local/share/DBeaverData/workspace6`, plus Flatpak (`~/.var/app/io.dbeaver.DBeaverCommunity/data/DBeaverData/workspace6`) and Snap (`~/snap/dbeaver-ce/current/.local/share/DBeaverData/workspace6`)
  - Inside the workspace, check `General/.dbeaver/` and every other project's `.dbeaver/`, plus the legacy `.metadata/.plugins/org.jkiss.dbeaver.core/`.
  - The env vars stay as optional overrides.
- [x] T2.2 Auto-detect the DBDelve directory, honouring `DBDELVE_VARIANT` (§3.3).
- [x] T2.3 Build every path with `path`/`os.homedir()`. The `.env` loader must handle CRLF line endings.
- [x] T2.4 Each source is optional. A source that is missing or broken is reported in `status`/`list_profiles` and does not stop the server.
- [x] T2.5 Rewrite `.env.example` and the README, with sections for each OS and client configs (Claude Desktop, Claude Code, Kiro).
- [x] T2.6 GitHub Actions matrix: ubuntu, macos and windows × Node 20 and 22, running unit tests and a smoke test (start the server, call `tools/list`).

  *Phase 2 notes:* `DBEAVER_WORKSPACE` was added as an override for a whole workspace. On Linux the first workspace candidate that has connections wins (native, Flatpak, Snap); they are not merged (D14). Ids outside DBeaver's `General` project are `dbeaver:<project>:<folder>/<name>`. `locateDbdelve()` is ready and tested, but nothing reads `profiles.toml` until Phase 5. `.gitattributes` marks the encrypted fixture as binary so Windows checkouts can't corrupt it. CI passed on all 6 jobs (PR #1).

### Phase 3: SQL Server
- [x] T3.1 Add `mssql` (it uses tedious, which is pure JS, so nothing native to build).
- [x] T3.2 `drivers/mssql.js`: a pool of size 1. `query` returns the recordset(s). `execute` returns rowsAffected for each batch.
- [x] T3.3 `drivers/mssql-auth.js`: an auth-strategy interface with `sql` (user/password) implemented now. Leave a stub where `entra-*` will plug in later, so it maps onto tedious `authentication.type` (D5).
- [x] T3.4 `sql/split-go.js`: treat `GO` (optionally followed by a count) as a separator only when it is alone on its line, and never inside strings or comments. Each batch runs in order (D6). Unit-test it.
- [x] T3.5 Map TLS: `disable` → `encrypt:false`; `prefer`/`require` → `encrypt:true, trustServerCertificate:true`; `verify-*` → `encrypt:true, trustServerCertificate:false`, plus the CA when given. DBeaver's `sslTrustServerCertificate`/`trustServerCertificate`/`encrypt` take priority.
- [x] T3.6 Defaults: port 1433 when missing. When `database` is empty, don't send a database name. `host\INSTANCE` is supported when no port is given.
- [x] T3.7 DBeaver: `provider` `sqlserver` (and `mssql` except the Sybase drivers), `auth-model: sqlserver_database`. Any other auth-model → skipped with a reason. jTDS → skipped.
- [ ] T3.8 DBDelve: `engine = "mssql"`. *(Moved into T5.2, because the DBDelve source arrives in Phase 5; see ADR-32.)*
- [x] T3.9 Integration test against the `mcr.microsoft.com/mssql/server` Docker image, run in CI on Linux only.

  *Phase 3 notes:* read-only `query` runs in a rolled-back transaction (ADR-28). TLS with no settings means verify-full (ADR-29). One pooled connection with batches and no request timeout; decimals come back as JS numbers (ADR-30). Several result sets come back as an array of arrays (ADR-31). The integration test is `test/mssql.integration.test.js`, which runs only when `MSSQL_TEST_PASSWORD` is set; CI has an `mssql` job on Linux.

### Phase 4: DuckDB
- [ ] T4.1 Add `@duckdb/node-api` as an **optional dependency** and load it lazily, so the server still runs on a platform without a prebuilt binary.
- [ ] T4.2 `drivers/duckdb.js`: open `path` read-write, or read-only when the profile says so (`access_mode`). Apply `schema` with `USE`. `execute` runs several statements.
- [ ] T4.3 Convert values: BIGINT/HUGEINT → string, DECIMAL, DATE/TIMESTAMP, LIST/STRUCT/MAP → JSON.
- [ ] T4.4 Lock conflicts: DuckDB allows one process to write a file. If DBDelve or DBeaver has the file open, return a clear error that says which file and why. The connection is closed on `disconnect` and when the server exits, so the lock is released.
- [ ] T4.5 DBDelve: `engine = "duckdb"`, `path`. Expand `~`, and refuse a file that does not exist rather than silently creating an empty database.
- [ ] T4.6 DBeaver DuckDB mapping: `provider: "duckdb"` → `path` from `configuration.database` (or remove the `jdbc:duckdb:` prefix from `url`). No credentials are required. `read-only` comes from `configuration["read-only"]`. An empty path or `:memory:` → skipped (an in-memory database has nothing to share).
- [ ] T4.7 Tests using a temporary DuckDB file.

### Phase 5: DBDelve source + keychain
- [ ] T5.1 Parse `profiles.toml` with `smol-toml`. Read only `[[profiles]]` and ignore unknown fields.
- [ ] T5.2 Map engines: `postgres` (or no engine), `mssql`, `duckdb`, and an `{ ssm = { engine } }` table → that engine plus an SSM tunnel. Any other engine → skipped with a reason.
- [ ] T5.3 Skip rules: `password_command` set (D3), `ssh.run_as` set, `service` (pg service file) set.
- [ ] T5.4 `secrets/keychain.js` reads the password from service `dbdelve[-variant]`, account = id. It is called **only when `connect` runs**, so `list_profiles` never triggers a keychain prompt. A missing entry gives a clear error.
- [x] T5.5 **Spike first:** check on macOS, Windows and Linux (gnome-keyring) that `@napi-rs/keyring` reads entries DBDelve wrote. If this fails, everything else in this phase is blocked. Note: DBDelve uses the Rust `keyring` crate **v4**, `@napi-rs/keyring` wraps **v3**, so Secret Service attributes may differ on Linux. The SSH passphrase service is `dbdelve[-variant]/ssh-passphrase`.
  - Run `node scripts/spike-keychain.js` on each OS. It reads every DBDelve profile's password, never prints a secret, and shows what the OS itself stores when a read misses.
  - **Linux: passed (2026-11-16, Secret Service).** Entries written by `keyring` 4.2.0 exactly as DBDelve writes them, read back by `@napi-rs/keyring` 2.1.2 in both directions, including the `…/ssh-passphrase` service. Then confirmed with a password DBDelve itself saved.
  - **macOS: passed (2026-11-16, arm64, Node 24).** A password saved by DBDelve itself was read, and `findCredentials` listed DBDelve's account. No access prompt appeared.
  - **Windows: not checked** (no Windows machine). It does not block Phases 3–5; check it before T5.4 ships on Windows. *(Ticked for Linux and macOS.)*
- [ ] T5.6 Map `sslmode`/`root_certificate`, default ports, empty `database`, `schema` and `mode`.
- [ ] T5.7 Tests: parsing fixtures with a mocked keychain.

### Phase 6: Tunnels
- [ ] T6.1 `tunnels/index.js`: pick a free local port, open the tunnel, wait until it is ready (with a timeout), and tie its lifetime to the session. On `connect` failure, `disconnect` or server exit, the child process is killed.
- [ ] T6.2 **SSH tunnel, using the system `ssh`** (the same approach as DBDelve, so `~/.ssh/config`, the agent and hardware keys all work):
  - `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<local>:<dbhost>:<dbport> [-p port] [-i key] [user@]host`
  - Key passphrases (from DBDelve's keychain, or from DBeaver's `network/ssh_tunnel` credentials) are passed through a small askpass helper (`SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force`), never on the command line. SSH password login is not supported (D11).
  - Without a secret, use `BatchMode=yes` so ssh never hangs waiting for a prompt.
  - Windows uses its built-in OpenSSH (`C:\Windows\System32\OpenSSH\ssh.exe`).
- [ ] T6.3 **Spike:** confirm that askpass works with Windows OpenSSH for **key passphrases**. If it does not, the fallback is to rely on ssh-agent (load the key into the Windows OpenSSH agent) and document that.
- [ ] T6.4 Unknown host keys: never switch off host-key checking. Fail with a message telling the user to run `ssh <host>` once to accept the key.
- [ ] T6.5 DBeaver SSH: read `handlers.ssh_tunnel` (host, port, user, auth type, key path) and the `network/ssh_tunnel` credentials (user and key passphrase). Password auth and jump hosts defined inside DBeaver → skipped with a reason (D11).
- [ ] T6.6 **SSM tunnel:** `aws ssm start-session --target <i-…> --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=<dbhost>,portNumber=<dbport>,localPortNumber=<local> [--profile] [--region]`.
  - Use `aws_cli`/`session_manager_plugin` from the profile when set; otherwise look them up on the PATH.
  - Wait for "Waiting for connections" before connecting.
  - On Windows, kill the whole process tree on close.
- [ ] T6.7 TLS through a tunnel: connect to `127.0.0.1` but check the certificate against the real hostname (`servername` for pg, `serverName` for tedious).
- [ ] T6.8 Integration test: an SSH tunnel to a Docker sshd + Postgres. SSM is tested manually only (it needs AWS).

### Phase 7: Polish
- [ ] T7.1 Add `reload_profiles` and the `list_profiles` filters. Show skip reasons.
- [ ] T7.2 Clean up stderr logging. Secrets never appear in logs or errors.
- [ ] T7.3 Bring CLAUDE.md and the README up to date (architecture, sources, engines, tunnels, OS paths).
- [ ] T7.4 Bump the version to 2.0.0 and list the breaking changes: the new name, the profile-id prefix, and the new tools.

## 6. Suggested order

Phase 0 → 1 → 2, then the **T5.5 keychain spike** and the **T6.3 askpass spike** done early, because they carry the most risk. After that: 3 → 4 → 5 → 6 → 7. SQL Server (3) and DuckDB (4) don't depend on each other and can be done in parallel.

## 7. Risks

| Risk | Mitigation |
|------|------------|
| `@napi-rs/keyring` cannot read entries DBDelve wrote | Spike T5.5 before building on it |
| macOS asks for Keychain access separately for `node` | Document "Always Allow"; prompts only happen at `connect` |
| Windows OpenSSH askpass behaves differently | Spike T6.3; fall back to ssh-agent |
| Tunnel processes left running | Kill the child process (process tree on Windows) on disconnect, `SIGINT`/`SIGTERM` and exit |
| The DuckDB file is locked by DBDelve | Clear error, plus `disconnect` to release the lock |
| No DuckDB prebuilt binary for a platform | Optional dependency, loaded lazily |
| DBDelve's format changes (the project moves fast) | Read only the fields we need; keep fixtures; unknown engine values → skipped, not a crash |
| Profile ids change and break saved prompts | Also accept an id without the prefix when it matches only one profile |

## 8. Open questions

Q-A to Q-D are answered (D10–D13).

- ~~**Q-E**~~ Commit author email → the GitHub `noreply` address, set in `mcp_dbs` only (answered 2026-11-16).
