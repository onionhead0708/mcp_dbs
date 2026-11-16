# Architecture decisions

Each decision has its reasons and consequences recorded here. `ROADMAP.md` §2 keeps the short list; this file says why. To change a decision, add a new entry that supersedes the old one instead of editing it, and update the old entry's status.

Status values: **Accepted**, **Superseded by ADR-n**, **Proposed** (not agreed yet).

| # | Decision | Status | Date |
|---|----------|--------|------|
| [1](#adr-1-rename-to-mcp-dbs) | Rename to `mcp-dbs` | Accepted | 2026-11-16 |
| [2](#adr-2-profile-ids-start-with-their-source) | Profile ids start with their source | Accepted | 2026-11-16 |
| [3](#adr-3-dbdelve-secrets-come-from-the-os-password-store-password_command-is-never-run) | DBDelve secrets from the OS password store; `password_command` never run | Accepted | 2026-11-16 |
| [4](#adr-4-ssh-and-aws-ssm-tunnels-are-in-scope) | SSH and AWS SSM tunnels are in scope | Accepted | 2026-11-16 |
| [5](#adr-5-sql-server-uses-sql-logins-behind-an-auth-strategy-interface) | SQL Server: SQL logins behind an auth-strategy interface | Accepted | 2026-11-16 |
| [6](#adr-6-execute-on-sql-server-splits-batches-on-go) | `execute` on SQL Server splits on `GO` | Accepted | 2026-11-16 |
| [7](#adr-7-duckdb-means-local-files-opened-read-write) | DuckDB: local files, opened read-write | Accepted | 2026-11-16 |
| [8](#adr-8-keep-execute-and-refuse-it-on-read-only-profiles) | Keep `execute`, refuse it on read-only profiles | Accepted | 2026-11-16 |
| [9](#adr-9-the-driver-layer-stays-generic) | The driver layer stays generic | Accepted | 2026-11-16 |
| [10](#adr-10-duckdb-connections-come-from-both-dbeaver-and-dbdelve) | DuckDB from both DBeaver and DBDelve | Accepted | 2026-11-16 |
| [11](#adr-11-dbeaver-ssh-tunnels-use-keys-only) | DBeaver SSH tunnels: keys only | Accepted | 2026-11-16 |
| [12](#adr-12-a-new-folder-and-repo-with-fresh-history) | New folder and repo, fresh history | Accepted | 2026-11-16 |
| [13](#adr-13-the-repo-is-public-and-holds-nothing-personal) | Public repo, nothing personal | Accepted | 2026-11-16 |
| [14](#adr-14-commits-use-the-github-noreply-address) | Commits use the GitHub `noreply` address | Accepted | 2026-11-16 |
| [15](#adr-15-an-id-without-its-prefix-is-accepted-when-it-is-unique) | Unprefixed ids accepted when unique | Accepted | 2026-11-16 |
| [16](#adr-16-profiles-carry-secret-references-resolved-only-at-connect) | Secret references, resolved at `connect` | Accepted | 2026-11-16 |
| [17](#adr-17-tls-comes-from-the-profile-the-old-rule-is-the-fallback) | TLS from the profile; old rule as fallback | Accepted | 2026-11-16 |
| [18](#adr-18-read-only-is-also-enforced-by-the-database-session) | Read-only enforced by the database session too | Accepted; SQL Server part superseded by ADR-28 | 2026-11-16 |
| [19](#adr-19-unusable-connections-are-listed-with-a-reason-not-hidden) | Unusable connections listed with a reason | Accepted | 2026-11-16 |
| [20](#adr-20-a-failing-source-never-stops-the-server) | A failing source never stops the server | Accepted | 2026-11-16 |
| [21](#adr-21-tool-output-is-json) | Tool output is JSON | Accepted | 2026-11-16 |
| [22](#adr-22-every-dbeaver-project-is-read-ids-outside-general-carry-the-project) | Every DBeaver project is read | Accepted | 2026-11-16 |
| [23](#adr-23-one-dbeaver-installation-on-linux-the-first-found-wins) | One DBeaver installation on Linux; first found wins | Accepted | 2026-11-16 |
| [24](#adr-24-paths-are-found-automatically-env-vars-are-overrides) | Paths found automatically; env vars override | Accepted | 2026-11-16 |
| [25](#adr-25-tools-live-in-srcserverjs-indexjs-only-wires) | Tools in `src/server.js`; `index.js` only wires | Accepted | 2026-11-16 |
| [26](#adr-26-ci-on-linux-macos-and-windows-with-node-20-and-22) | CI on three OSes × Node 20/22 | Accepted | 2026-11-16 |
| [27](#adr-27-napi-rskeyring-pinned-to-secret-service-on-linux) | `@napi-rs/keyring`, pinned to Secret Service on Linux | Accepted | 2026-11-16 |
| [28](#adr-28-sql-server-read-only-queries-run-in-a-transaction-that-is-rolled-back) | SQL Server read-only: queries run in a rolled-back transaction | Accepted | 2026-11-16 |
| [29](#adr-29-sql-server-tls-verify-unless-told-otherwise) | SQL Server TLS: verify unless told otherwise | Accepted | 2026-11-16 |
| [30](#adr-30-sql-server-one-pooled-connection-batches-and-no-request-timeout) | SQL Server: one connection, batches, no request timeout | Accepted | 2026-11-16 |
| [31](#adr-31-several-result-sets-come-back-as-an-array-of-arrays) | Several result sets come back as an array of arrays | Accepted | 2026-11-16 |
| [32](#adr-32-dbdelves-sql-server-profiles-arrive-with-the-dbdelve-source) | DBDelve's SQL Server profiles arrive with the DBDelve source | Accepted | 2026-11-16 |
| [33](#adr-33-duckdb-through-duckdbnode-api-20-an-optional-dependency) | DuckDB through `@duckdb/node-api` 2.0, an optional dependency | Accepted | 2026-11-16 |
| [34](#adr-34-duckdb-values-come-from-duckdbs-own-json-conversion) | DuckDB values come from DuckDB's own JSON conversion | Accepted | 2026-11-16 |
| [35](#adr-35-a-missing-duckdb-file-is-refused-never-created) | A missing DuckDB file is refused, never created | Accepted | 2026-11-16 |
| [36](#adr-36-a-locked-duckdb-file-is-an-error-with-no-automatic-fallback) | A locked DuckDB file is an error, with no automatic fallback | Accepted | 2026-11-16 |
| [37](#adr-37-no-saved-keychain-password-means-a-blank-password) | No saved keychain password means a blank password | Accepted | 2026-11-16 |
| [38](#adr-38-dbdelve-profiles-follow-dbdelves-own-defaults-unknown-values-fail-safe) | DBDelve profiles follow DBDelve's defaults; unknown values fail safe | Accepted | 2026-11-16 |
| [39](#adr-39-tunnelled-profiles-wait-for-phase-6-in-every-source) | Tunnelled profiles wait for Phase 6, in every source | Accepted | 2026-11-16 |
| [40](#adr-40-dbdelve_profiles-points-at-a-profilestoml) | `DBDELVE_PROFILES` points at a `profiles.toml` | Accepted | 2026-11-16 |
| [41](#adr-41-a-tunnel-is-ready-when-its-program-says-so) | A tunnel is ready when its program says so | Accepted | 2026-11-16 |
| [42](#adr-42-ssh-secrets-go-through-a-narrow-askpass-helper-host-keys-are-never-accepted-for-the-user) | SSH secrets through a narrow askpass helper; host keys never accepted for the user | Accepted | 2026-11-16 |
| [43](#adr-43-tunnel-processes-are-stopped-as-a-tree) | Tunnel processes are stopped as a tree | Accepted | 2026-11-16 |
| [44](#adr-44-mcp_dbs_ssh_config-names-an-ssh-config-file) | `MCP_DBS_SSH_CONFIG` names an ssh config file | Accepted | 2026-11-16 |
| [45](#adr-45-dbeaver-ssh-tunnels-are-read-the-way-dbdelve-imports-them) | DBeaver SSH tunnels are read the way DBDelve imports them | Accepted | 2026-11-16 |

ADR-1 to ADR-13 are D1–D13 in `ROADMAP.md` §2, and ADR-14 is Q-E. ADR-15 onwards were decided while building Phases 1 and 2.

---

## ADR-1: Rename to `mcp-dbs`

**Context.** The server started as `mcp-postgresql`. It is gaining SQL Server and DuckDB, with MySQL and SQLite possible later.

**Decision.** The package name, `bin`, the MCP server name and the docs all say `mcp-dbs`. Renaming the old repo or folder is optional.

**Why.** A name tied to one engine would be wrong as soon as the second engine lands. Renaming once, before any other changes, keeps the history readable.

**Consequences.** Client configs that use the old server name have to be updated. This is listed as a breaking change for 2.0.0 (T7.4).

## ADR-2: Profile ids start with their source

**Context.** Profiles come from DBeaver and DBDelve, and both can hold a connection with the same name.

**Decision.** Ids are `dbeaver:<folder/name>` and `dbdelve:<id>`.

**Why.** Ids must not clash between sources, and the user should be able to see where a profile came from.

**Consequences.** Ids saved before this change no longer match exactly. ADR-15 softens that.

## ADR-3: DBDelve secrets come from the OS password store; `password_command` is never run

**Context.** DBDelve keeps passwords and SSH passphrases in the OS keychain (Keychain Services, Secret Service, Credential Manager). A profile can also have a `password_command`, which is a shell command that prints the password.

**Decision.** Secrets are read from the OS password store only. A profile with `password_command` is skipped and the reason is given. There is no env-var or headless fallback, because a desktop session is assumed.

**Why.**
- Running a command taken from a config file would let anything that can edit `profiles.toml` run code inside the MCP server, which an AI client drives.
- Reading the keychain that DBDelve already uses means no second copy of any secret.
- Both DBeaver and DBDelve are desktop apps, so a keychain is always there.

**Consequences.** Profiles that use `password_command` cannot be used through mcp-dbs. On macOS the keychain may ask once to let `node` read an item. T5.5 tests whether `@napi-rs/keyring` can read entries that DBDelve wrote. DBDelve uses the Rust `keyring` crate v4, while `@napi-rs/keyring` is built on v3, so that is not guaranteed.

## ADR-4: SSH and AWS SSM tunnels are in scope

**Context.** Many real databases can only be reached through a bastion host or AWS Session Manager.

**Decision.** Both tunnel types are supported (Phase 6).

**Why.** Without tunnels, every such profile would be unusable, which is a large share of the connections people actually need.

**Consequences.** The server has to start child processes and clean them up (ssh, aws), as described in ADR-11 and Phase 6. Until Phase 6, DBeaver connections that have an SSH tunnel switched on are skipped with a reason (ADR-19).

## ADR-5: SQL Server uses SQL logins, behind an auth-strategy interface

**Decision.** SQL Server sign-in uses a username and password only. The driver gets its login through an auth-strategy interface, so Entra (Azure AD) can be added later without reworking the driver.

**Why.** SQL logins cover what we use today. The interface means Entra later is an addition, not a rewrite.

**Consequences.** DBeaver connections that use another `auth-model` (NTLM, Kerberos, AD) are skipped with a reason.

## ADR-6: `execute` on SQL Server splits batches on `GO`

**Decision.** For SQL Server, `execute` splits the text on lines that hold only `GO` (optionally followed by a count), never inside strings or comments, and runs the batches in order.

**Why.** `GO` is a client-side separator (SSMS, sqlcmd), not T-SQL. Scripts people paste rely on it, and the server rejects it.

## ADR-7: DuckDB means local files, opened read-write

**Decision.** DuckDB profiles are local database files, opened read-write. They are opened read-only only when the profile is marked read-only.

**Why.** This matches how DBeaver and DBDelve open the same files, and `execute` needs write access.

**Consequences.** DuckDB lets only one process write to a file at a time. If DBDelve or DBeaver has the file open, `connect` fails with a clear error (T4.4), and `disconnect` exists so the lock can be released.

## ADR-8: Keep `execute` and refuse it on read-only profiles

**Decision.** The `execute` tool stays, and it is refused when the profile is read-only.

**Why.** Being able to write is useful. A read-only flag set in DBeaver or DBDelve has to mean read-only here too.

**Consequences.** See ADR-18 for how the database itself also enforces read-only.

## ADR-9: The driver layer stays generic

**Decision.** Drivers implement one interface: `connect(profile, endpoint, { password })`, `query`, `execute`, `serverVersion`, `close`. Engines are looked up by name.

**Why.** MySQL/MariaDB and SQLite are expected later. Adding one should mean writing a driver, without touching the session or the tools.

## ADR-10: DuckDB connections come from both DBeaver and DBDelve

**Why.** Both tools can hold DuckDB connections, and users should not have to recreate them in the other tool.

**Consequences.** DBeaver's DuckDB connections have no credentials, so the "skip when there is no saved user/password" rule must not apply to DuckDB (T4.6).

## ADR-11: DBeaver SSH tunnels use keys only

**Decision.** A DBeaver tunnel that logs in with a key (with or without a passphrase) is supported. A DBeaver tunnel that logs in with a password is skipped with a reason.

**Why.** Tunnels run the system `ssh`, the same way DBDelve does, so `~/.ssh/config`, the agent and hardware keys all work. A key passphrase can be passed safely through an askpass helper. Supporting password login would mean feeding a login password to ssh, which is more fragile and less safe, and keys are the common setup.

**Consequences.** T6.3 tests whether askpass works with Windows OpenSSH. If it does not, the fallback is ssh-agent.

## ADR-12: A new folder and repo, with fresh history

**Context.** The history of `mcp_postgresql` contains a work email in the commit authors, customer names, and personal paths in old planning notes.

**Decision.** The work happens in a new folder `mcp_dbs`, with a new GitHub repo that starts from one clean commit. `mcp_postgresql` is left as it is.

**Why.** Removing private details from git history is error-prone. Starting fresh is certain.

## ADR-13: The repo is public and holds nothing personal

**Decision.** `mcp_dbs` is public, under the personal GitHub account. Nothing personal is committed: no `.env`, real hostnames, user paths, internal connection or customer names, or secrets, and that includes test fixtures.

**Consequences.** Fixtures use `example.com`, `/home/user` and fake passwords. The encrypted DBeaver fixture is regenerated from fake data by `scripts/make-dbeaver-credentials.js`.

## ADR-14: Commits use the GitHub `noreply` address

**Decision.** The commit author email for this repo is the GitHub `noreply` address, set in `mcp_dbs` only (this was Q-E).

**Why.** It follows from ADR-13: a public history should not expose a personal or work email.

## ADR-15: An id without its prefix is accepted when it is unique

**Decision.** `connect` accepts `Production/orders-db` for `dbeaver:Production/orders-db` when exactly one profile matches. If several match, it refuses and lists them.

**Why.** ADR-2 changed every id. This keeps saved prompts and habits working, and it never guesses between two profiles.

## ADR-16: Profiles carry secret references, resolved only at `connect`

**Decision.** A profile holds a reference to its secret, not the secret itself. `resolveSecret()` turns the reference into text only when `connect` runs. DBeaver's passwords, which are already decrypted from its file, are wrapped in an `InlineSecret` that keeps the value in a private field.

**Why.**
- `list_profiles` must never trigger a keychain prompt (ADR-3, T5.4).
- Profiles get printed, logged and put into errors. A private field never appears in `JSON.stringify` or `util.inspect`, and a test checks that.

## ADR-17: TLS comes from the profile; the old rule is the fallback

**Decision.**
- DBeaver: take the mode from the enabled `*_ssl` handler (`sslMode`, `ssl.verify.server`, `ssl.require`, CA in `ssl.ca.cert`), then from the `sslmode` driver property. This is the same order DBDelve's importer uses.
- If neither says anything, keep the old rule: no TLS for `localhost` and the `local`/`no_ssl` folders, and TLS without checking the certificate for everything else.
- An SSL mode we don't recognise is treated as `verify-full`.
- `prefer` tries TLS first and falls back to an unencrypted connection only when the server has no TLS.

**Why.** Users' existing behaviour stays the same unless they configured TLS, and nothing ever gets less security than it asked for.

## ADR-18: Read-only is also enforced by the database session

**Decision.** On Postgres, read-only profiles run `SET default_transaction_read_only = on` after connecting, as well as having `execute` refused (ADR-8).

**Why.** `query` takes any SQL, so `DELETE … RETURNING` would get past a check on the tool name alone. The database now refuses the write.

**Consequences.** Each engine needs its own way to do this. DuckDB uses `access_mode` (T4.2). For SQL Server, `ApplicationIntent=ReadOnly` does not block writes, so `execute` refusal is the guard there unless a better one is found.

*Update:* ADR-28 found that better way for SQL Server.

## ADR-19: Unusable connections are listed with a reason, not hidden

**Decision.** `list_profiles` returns `skipped` entries, each with an id and a reason. Examples: no saved password, an engine not supported yet, an SSH tunnel not supported yet, a bad port. A DBeaver connection with any network handler switched on (other than SSL) is skipped until Phase 6, rather than connecting straight to the database host.

**Why.** "Where is my connection?" is the first question users ask. Connecting without the tunnel would fail confusingly, or reach the wrong host.

## ADR-20: A failing source never stops the server

**Decision.** If a profile source fails (not installed, file missing, decrypt error), the failure is reported in `list_profiles` `errors` and in `status` `sources`. The other sources, and other projects in the same source, still load.

**Why.** Each source is optional (T2.4). One broken file must not cost the user every other connection.

## ADR-21: Tool output is JSON

**Decision.**
- `list_profiles` and `status` return JSON objects.
- Query rows are made JSON-safe:
  - BigInt becomes a string, to avoid precision loss above 2^53.
  - Binary data becomes `\x…` hex (Postgres's own notation).
  - Dates become ISO strings.
  - Decimal-like objects use their own `toString`.
  - Map and Set are converted, and cycles are cut.
- `query` takes `max_rows`, and says when it cut the result.

**Why.** MCP clients are LLMs that read structure well. Before, `list_profiles` returned one id per line, which could not carry engine, source or skip reasons. Binary data used to come out as `{"type":"Buffer","data":[…]}`, which is huge and useless.

**Consequences.** This is a breaking change in `list_profiles` output, to be noted for 2.0.0 (T7.4).

## ADR-22: Every DBeaver project is read; ids outside General carry the project

**Decision.** All `<project>/.dbeaver/data-sources*.json` files in the workspace are read. Ids from the `General` project are `dbeaver:<folder>/<name>`. Ids from other projects are `dbeaver:<project>:<folder>/<name>`. The pre-6.1.3 layout (`.metadata/.plugins/org.jkiss.dbeaver.core/`) is used only when no project has files of its own.

**Why.**
- Users with several DBeaver projects expect to see all of them.
- `General` is what nearly everyone uses, so its ids stay short and unchanged.
- The `:` separator can't be confused with a folder path, which uses `/`.

**Consequences.** If the same id still appears twice, the first is kept and the second is skipped with a reason.

## ADR-23: One DBeaver installation on Linux; the first found wins

**Context.** On Linux, DBeaver can be installed natively, as a Flatpak, or as a Snap, and each has its own workspace.

**Decision.** We assume one installation. The workspaces are checked in order (native, Flatpak, Snap), the first one that has connections is used, and the others are not merged in.

**Why.** Merging would produce duplicate ids for the same connections, and a second installation is usually a stale leftover. `DBEAVER_WORKSPACE` can point at a specific one (ADR-24). Decided by the user on 2026-11-16.

## ADR-24: Paths are found automatically; env vars are overrides

**Decision.** DBeaver's workspace is found in the usual place for each OS. The env vars override it, in this order:
1. `DBEAVER_DATA_SOURCES_JSON` and `DBEAVER_CREDENTIALS_CONFIG_JSON`: exactly one pair of files. The credentials file defaults to the one next to `data-sources.json`.
2. `DBEAVER_WORKSPACE`, which is new: a whole workspace.

DBDelve's folder follows DBDelve's own `store.rs`: `$XDG_DATA_HOME`, `~/Library/Application Support` or `%APPDATA%`, plus `dbdelve[-$DBDELVE_VARIANT]`. A variant that can't be a folder name is an error rather than a silent fallback. `~` is expanded in env paths, and `.env` may use CRLF line endings or a BOM.

**Why.** Most users should not need to configure anything. The existing env vars keep working. Matching DBDelve's rules exactly matters, because the keychain service name comes from the same variant.

## ADR-25: Tools live in `src/server.js`; `index.js` only wires

**Decision.** This deviates slightly from the layout in roadmap §4. The tool definitions and handlers are in `src/server.js` (`createHandlers`). `index.js` only loads settings, builds the registry and the session, and connects stdio. `console.log` is sent to stderr.

**Why.** Handlers can then be unit-tested with a fake driver and no MCP transport. Anything a library logs can no longer corrupt the MCP stream on stdout.

## ADR-26: CI on Linux, macOS and Windows with Node 20 and 22

**Decision.** GitHub Actions runs `npm test` (unit tests plus a stdio smoke test) on ubuntu, macos and windows × Node 20 and 22, on pushes to `main` and on pull requests. `.gitattributes` forces LF line endings and marks the encrypted DBeaver fixture as binary.

**Why.** Cross-platform support (G3) is only real if it is tested. A Windows checkout that converted line endings in the encrypted fixture would break decryption.

**Consequences.** Tests that check OS paths use `hostInfo({ platform, env, home })`, so all three OSes' rules are checked on every runner.

## ADR-27: `@napi-rs/keyring`, pinned to Secret Service on Linux

**Context.** ADR-3 needs Node to read keychain entries that DBDelve wrote with the Rust `keyring` crate 4.2.0. `@napi-rs/keyring` 2.1.2 ships prebuilt binaries for all three OSes, but it wraps a different major version of the crate. On Linux it also falls back silently to the kernel keyring when Secret Service is not available.

**Decision.** Use `@napi-rs/keyring`. On Linux, always pass `{ linux: { store: "secret-service" } }`.

**Why.**
- On Linux, the spike (T5.5) wrote entries with `keyring` 4.2.0 exactly as DBDelve's `store.rs` does, and read them with `@napi-rs/keyring`. It also tested the other direction and the `dbdelve/ssh-passphrase` service. All of it matched. A password saved by DBDelve itself was then read on a real Linux desktop.
- Without the pin, a missing Secret Service would look like "no password saved" instead of a clear error. DBDelve never writes to the kernel keyring, so falling back to it can never find anything.

- On macOS (arm64), the spike read a password that DBDelve itself had saved, and `findCredentials` listed DBDelve's account. No access prompt appeared.

**Consequences.** Windows (Credential Manager) has not been checked yet, because there is no Windows machine. Check it with `scripts/spike-keychain.js` before Phase 5 is relied on there. The package is a regular dependency, so CI checks that it installs on every OS.

## ADR-28: SQL Server read-only: queries run in a transaction that is rolled back

**Context.** ADR-18 wants the database to refuse writes on read-only profiles, not just the `execute` tool. SQL Server has no session-wide read-only switch. `ApplicationIntent=ReadOnly` only routes to a replica, and a read-only login would need server-side setup.

**Decision.** On read-only SQL Server profiles, `query` opens a transaction, runs the batch in it, and always rolls it back. `execute` is still refused (ADR-8).

**Why.** An LLM that sends `UPDATE` or `DELETE … OUTPUT` through `query` by mistake gets the rows back, but nothing is kept. Reads are unaffected.

**Consequences.**
- This guards against mistakes, not against someone determined: a script that issues its own `COMMIT` gets past it. True enforcement needs a read-only login, which is the server owner's job.
- Statements that cannot run in a transaction (`CREATE DATABASE`, `BACKUP`) fail on read-only profiles, which is acceptable.

## ADR-29: SQL Server TLS: verify unless told otherwise

**Decision.** TLS settings map to tedious like this:

| Setting | Result |
|---|---|
| `disable` | no encryption |
| `prefer` or `require` | encrypt, trust any certificate |
| `verify-ca` or `verify-full` | encrypt and verify, with the CA when one is given |
| DBeaver's `trustServerCertificate` / `sslTrustServerCertificate` | wins over the mode |
| DBeaver's `encrypt=false\|optional` | no encryption |
| nothing said at all | **verify-full** |

`verify-ca` is checked as `verify-full`. Through a tunnel, the certificate is checked against the real hostname (tedious `serverName`).

**Why.**
- Microsoft's JDBC driver has encrypted and verified by default since 10.2, so a DBeaver connection that works without settings either has a valid certificate or has trust switched on. This matches DBDelve's importer.
- The Postgres fallback rule (no TLS for localhost) is not carried over. SQL Server always negotiates TLS for the login, and DBeaver users of local Docker images already have trust switched on.
- tedious can't skip only the hostname check, and checking more is never less than was asked for (ADR-17).

## ADR-30: SQL Server: one pooled connection, batches, no request timeout

**Decision.**
- The `mssql` pool is capped at one connection.
- Both `query` and `execute` send SQL as batches (`request.batch`), not through `sp_executesql`.
- There is no request timeout, which matches DBeaver. Connecting times out after 15 s.
- The pool's `error` event is always listened to.

**Why.**
- With a single connection, session state carries over between calls: `#temp` tables, `USE`, `SET`. That is what a user expects from a "connection".
- Sending a batch keeps `CREATE PROCEDURE`/`VIEW` as the first statement of its batch, and keeps `#temp` tables alive. `sp_executesql` would drop them when it finishes.
- An unhandled pool `error` would crash the server, as `pg`'s did.

**Consequences.**
- If the connection drops, the pool reconnects silently on the next call, and session state is lost.
- DECIMAL, NUMERIC and MONEY come back from tedious as JS numbers, so values beyond 15–17 significant digits lose precision. tedious has no option to return them as strings. Users who need exact values can `CAST(... AS varchar)`.

## ADR-31: Several result sets come back as an array of arrays

**Decision.** If a SQL Server batch returns more than one result set, `query` returns a JSON array with one array of rows per set, and `max_rows` applies to each set. With one set or none, the output is a plain array of rows, as before. Postgres keeps returning the last statement's rows.

**Why.** Stored procedures and scripts commonly return several sets. Dropping all but one would hide data. Keeping the single-set shape unchanged means existing users see no difference.

## ADR-32: DBDelve's SQL Server profiles arrive with the DBDelve source

**Context.** T3.8 (DBDelve `engine = "mssql"`) is in Phase 3, but nothing reads DBDelve's `profiles.toml` until Phase 5.

**Decision.** T3.8 is done as part of T5.2, the DBDelve engine mapping. The SQL Server driver needs nothing more for it: a profile with `engine: "mssql"` works whichever source made it.

## ADR-33: DuckDB through `@duckdb/node-api` 2.0, an optional dependency

**Context.** DuckDB needs a native binary. DBDelve pins the `duckdb` crate at 1.20000.1, which is DuckDB **2.0.0**. Two programs sharing a file should use the same engine version, so neither meets a storage format it doesn't know.

**Decision.** Use DuckDB's official Node client, `@duckdb/node-api` 2.0.0-r.1 (DuckDB 2.0.0), as an **optional** dependency. `drivers/duckdb.js` imports it only when a DuckDB profile connects.

**Why.**
- Same engine version as DBDelve.
- Prebuilt binaries exist for Linux (glibc and musl), macOS and Windows on x64 and arm64.
- Because it is optional and loaded only when needed, the server still installs and runs where no binary exists (T4.1). Connecting to DuckDB there fails with a message that names the platform.

**Consequences.** When DBDelve moves to a new DuckDB version, this dependency should follow. DBeaver's JDBC driver may be on an older DuckDB: DuckDB opens older files, but a file written by a newer DuckDB may not open in an older one.

## ADR-34: DuckDB values come from DuckDB's own JSON conversion

**Decision.** `query` returns `reader.getRowObjectsJson()` as it is, instead of passing JS values through `format.js`:

| Type | Comes back as |
|---|---|
| BIGINT, HUGEINT | exact strings |
| DECIMAL | exact text |
| TIMESTAMP | text with microseconds, no time-zone conversion |
| LIST, STRUCT | JSON |
| MAP | `[{key, value}]` |
| BLOB | `\x…` hex |

`execute` prepares and runs each statement separately, so each one reports its type and the rows it changed.

**Why.** Converting through JS values loses information: a JS `Date` drops microseconds, and a JS number drops decimal digits. This meets T4.3 without our own code for each type.

**Consequences.** Timestamps look different across engines. DuckDB gives `2026-01-02 03:04:05.123456`, while Postgres and SQL Server give ISO strings ending in `Z`. A future change could make them all the same.

## ADR-35: A missing DuckDB file is refused, never created

**Decision.** The DuckDB driver refuses a path that doesn't exist or isn't a file, and expands `~`. DuckDB itself would quietly create an empty database there.

**Why.** A mistyped or moved path would otherwise "connect" to a new empty database. The user would see an empty schema and be confused, and a stray file would be left behind (T4.5). The check is in the driver, so it covers DuckDB profiles from every source.

## ADR-36: A locked DuckDB file is an error, with no automatic fallback

**Context.** DuckDB lets only one process write to a file. A read-only open also conflicts with a process that has the file open read-write.

**Decision.** If the file is held by another program, `connect` fails with an error that names the file and, where the OS gives it, the process. The error tells the user to disconnect in DBDelve or DBeaver. The server does not try again read-only.

**Why.** Trying again read-only would fail against the same lock, and it would quietly change what the user asked for. The lock is released by `disconnect`, by connecting to another profile, and when the server exits.

**Consequences.** Linux and macOS report a lock with a process number. Windows reports a sharing violation without one. Both are recognised.

## ADR-37: No saved keychain password means a blank password

**Context.** T5.4 said a missing keychain entry gives a clear error. DBDelve, though, treats "no keychain item" as a blank password and connects anyway, because a blank password is valid. That covers servers with trust or peer authentication, and logins that have no password.

**Decision.** Do what DBDelve does: connect with a blank password. If that connection then fails, the error says that no password is saved, and names the keychain service and account to save it under in DBDelve. If the password store can't be used at all (locked, no Secret Service, access refused), that is a clear error straight away.

**Why.** A profile that works in DBDelve has to work here too. The hint still gives the clear message T5.4 asked for, but only when it is actually the problem.

## ADR-38: DBDelve profiles follow DBDelve's defaults; unknown values fail safe

**Decision.** Fields are read with DBDelve's own meanings (`StoredProfile` in `store.rs`):

| Field | Meaning here |
|---|---|
| `engine` missing | `postgres` |
| `engine = { ssm = { engine } }` | that engine, plus an SSM tunnel |
| `sslmode` missing | `prefer` (it predates TLS settings) |
| `port` missing | the engine default |
| `database` empty | the login's default database |
| `mode` missing, `read-write` or `full` | writable |
| `mode = "read-only"` | read-only |

When a value can't be understood, the safe side wins:
- An unknown `mode` is treated as **read-only**. DBDelve itself reads it as read-write.
- An unknown `sslmode` is treated as `verify-full`.
- An unknown engine is skipped with a reason.
- Plugin connections (`speaks`/`connection`) are skipped, and so are `password_command` (ADR-3), `service` and `ssh.run_as`.

Only `[[profiles]]` is read, and unknown fields are ignored.

**Why.** DBDelve changes quickly (roadmap risk table). A value added in a newer DBDelve must never quietly make a connection more writable or less encrypted than the user meant.

## ADR-39: Tunnelled profiles wait for Phase 6, in every source

**Decision.** DBDelve's `[profiles.ssh]` and `[profiles.ssm]` are already mapped onto the profile model's `tunnel`, including the passphrase reference `dbdelve[-variant]/ssh-passphrase`. Until a tunnel type is listed in `SUPPORTED_TUNNELS` (`src/tunnels/index.js`), those profiles are skipped with a reason, as DBeaver's are (ADR-19). DuckDB profiles with a tunnel are always skipped.

**Why.** Users see their tunnelled connections and why they can't be used yet, and nothing tries the database host directly. Phase 6 only has to add the type to the set.

## ADR-40: `DBDELVE_PROFILES` points at a `profiles.toml`

**Decision.** A new optional env var, `DBDELVE_PROFILES`, names a `profiles.toml` directly, in the same way `DBEAVER_DATA_SOURCES_JSON` does for DBeaver. The keychain service still comes from `DBDELVE_VARIANT`.

**Why.** Tests, and users with an unusual setup, need to point at a file without faking a home folder on every OS. The keychain service has to keep following the variant, or the passwords would be read from the wrong place.

## ADR-41: A tunnel is ready when its program says so

**Decision.**
- The local port is picked by the OS (`listen(0)` on 127.0.0.1) and then given to the tunnel program.
- ssh runs with `-v`. The tunnel is ready when ssh logs `Local forwarding listening on 127.0.0.1 port N`, which ssh only does after logging in.
- The SSM tunnel is ready when the plugin prints `Waiting for connections`.
- If the program exits first, or nothing happens within 30 s, `connect` fails with an explanation built from the program's own output, and the program is stopped.
- Through a tunnel, a SQL Server named instance needs its port. SQL Server Browser uses UDP, which no tunnel carries.

**Why.**
- Polling the local port would race with ssh's login, and could reach something else that took the port.
- The log line is exact, and it also proves that the login worked.
- `ExitOnForwardFailure=yes` makes ssh exit, rather than carry on without a tunnel, if the port was taken in between.

## ADR-42: SSH secrets go through a narrow askpass helper; host keys are never accepted for the user

**Decision.**
- **With a passphrase saved.** It reaches ssh through `SSH_ASKPASS` (with `SSH_ASKPASS_REQUIRE=force`), via a small helper:
  - The helper is a shell or `.cmd` wrapper around `askpass.mjs`, written to a private temp folder.
  - It reads the passphrase from an env var that only ssh's environment carries.
  - It answers **only** prompts that ask for a passphrase. A host-key question or a password prompt gets no answer.
- **Without a passphrase saved.** ssh runs with `BatchMode=yes`.
- **Always:**
  - `PasswordAuthentication=no` and `KbdInteractiveAuthentication=no` (ADR-11).
  - Host-key checking is left exactly as the user's ssh config sets it. If the key is unknown or has changed, `connect` fails and tells the user to run `ssh <host>` once (T6.4).

**Why.**
- The passphrase never appears on a command line, where other users could read it in the process list, and never in a file.
- The helper can't be tricked into accepting a host key.
- `BatchMode` means a key that needs a passphrase fails at once, instead of hanging on a prompt nobody can see.

**Consequences.** The error says whether the key's passphrase was wrong or missing: ssh logs "Server accepts key" and then "Permission denied". T6.3 confirmed in CI that each OS's OpenSSH runs the helper, Windows' built-in OpenSSH 9.5 included, even with a passphrase full of shell and cmd special characters.

## ADR-43: Tunnel processes are stopped as a tree

**Decision.**
- On Linux and macOS, ssh and aws are started as the leaders of their own process groups, and the whole group is sent SIGTERM.
- On Windows, `taskkill /T /F` is used.
- Every tunnel process is stopped on `disconnect`, on a failed `connect`, on connecting to another profile, and when the server exits (a synchronous `exit` handler, plus SIGINT/SIGTERM and stdin closing).

**Why.** `aws ssm start-session` starts `session-manager-plugin`, which holds the port. Stopping only `aws` would leave the plugin running (roadmap risk "Tunnel processes left running").

**Consequences.** If the server is killed with SIGKILL, no handler runs, so its tunnel processes can be left behind. Nothing short of an external supervisor can prevent that.

## ADR-44: `MCP_DBS_SSH_CONFIG` names an ssh config file

**Decision.** If set, it is passed to ssh as `-F <file>`, in place of `~/.ssh/config`.

**Why.**
- ssh finds `~/.ssh` from the OS user database, not `$HOME`, so tests could not otherwise give ssh their own known-hosts file and keys without touching the user's.
- Users who keep a separate ssh config for database bastions can use it too.

## ADR-45: DBeaver SSH tunnels are read the way DBDelve imports them

**Decision.** An enabled `ssh_tunnel` handler is used when it is set up as:
- `authType` `PUBLIC_KEY`, with `keyPath` if one is given, or
- `authType` `AGENT`.

It is skipped with a reason when:
- it logs in with a password (ADR-11)
- it goes through jump servers (`jumpServer.count`, `jumpServerEnabled`)
- it has no host
- its key path is relative. ssh would resolve it against the server's working folder.

The user comes from the connection's `network/ssh_tunnel` credentials, and that entry's `password` is used as the key's passphrase. Other network handlers, such as proxies, are still skipped.

**Why.** It matches DBDelve's importer (`ssh()` in `src/import/dbeaver.rs`), so a connection behaves the same in DBeaver, DBDelve and here.
