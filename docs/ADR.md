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
| [18](#adr-18-read-only-is-also-enforced-by-the-database-session) | Read-only enforced by the database session too | Accepted | 2026-11-16 |
| [19](#adr-19-unusable-connections-are-listed-with-a-reason-not-hidden) | Unusable connections listed with a reason | Accepted | 2026-11-16 |
| [20](#adr-20-a-failing-source-never-stops-the-server) | A failing source never stops the server | Accepted | 2026-11-16 |
| [21](#adr-21-tool-output-is-json) | Tool output is JSON | Accepted | 2026-11-16 |
| [22](#adr-22-every-dbeaver-project-is-read-ids-outside-general-carry-the-project) | Every DBeaver project is read | Accepted | 2026-11-16 |
| [23](#adr-23-one-dbeaver-installation-on-linux-the-first-found-wins) | One DBeaver installation on Linux; first found wins | Accepted | 2026-11-16 |
| [24](#adr-24-paths-are-found-automatically-env-vars-are-overrides) | Paths found automatically; env vars override | Accepted | 2026-11-16 |
| [25](#adr-25-tools-live-in-srcserverjs-indexjs-only-wires) | Tools in `src/server.js`; `index.js` only wires | Accepted | 2026-11-16 |
| [26](#adr-26-ci-on-linux-macos-and-windows-with-node-20-and-22) | CI on three OSes × Node 20/22 | Accepted | 2026-11-16 |
| [27](#adr-27-napi-rskeyring-pinned-to-secret-service-on-linux) | `@napi-rs/keyring`, pinned to Secret Service on Linux | Accepted | 2026-11-16 |

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
