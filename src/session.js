// The one active connection: its profile, driver handle and tunnel.
import { getDriver as defaultGetDriver } from "./drivers/index.js";
import { openTunnel as defaultOpenTunnel } from "./tunnels/index.js";
import { resolveSecret as defaultResolveSecret } from "./secrets/index.js";

export class Session {
  #getDriver;
  #openTunnel;
  #resolveSecret;
  #active = null;

  constructor({ getDriver = defaultGetDriver, openTunnel = defaultOpenTunnel, resolveSecret = defaultResolveSecret } = {}) {
    this.#getDriver = getDriver;
    this.#openTunnel = openTunnel;
    this.#resolveSecret = resolveSecret;
  }

  get profile() {
    return this.#active?.profile ?? null;
  }

  /** Closes any current connection first, then opens the tunnel and the driver. */
  async connect(profile) {
    await this.disconnect();
    const driver = this.#getDriver(profile.engine);
    const ref = profile.auth?.secretRef;
    const secret = await this.#resolveSecret(ref);
    // Nothing saved in the keychain is a blank password, as in DBDelve: a
    // server that needs none still connects (ADR-37).
    const unsaved = secret === null;
    const password = unsaved ? "" : secret;
    const tunnel = await this.#openTunnel(profile);
    let handle;
    try {
      handle = await driver.connect(profile, tunnel, { password });
    } catch (error) {
      await tunnel.close().catch(() => {});
      if (unsaved) {
        error.message +=
          `. No password is saved for this profile in the OS password store (service '${ref.service}', account '${ref.account}'):` +
          " save it in DBDelve and connect again";
      }
      throw error;
    }
    this.#active = { profile, driver, handle, tunnel, connectedAt: new Date() };
  }

  #require() {
    if (!this.#active) throw new Error("No active database connection. Use connect first.");
    return this.#active;
  }

  async query(sql) {
    const { driver, handle } = this.#require();
    return driver.query(handle, sql);
  }

  async execute(sql) {
    const { driver, handle, profile } = this.#require();
    if (profile.readOnly) throw new Error(`Profile '${profile.id}' is read-only; execute is not allowed.`);
    return driver.execute(handle, sql);
  }

  /** Closes the driver and the tunnel. Returns the profile that was closed, if any. */
  async disconnect() {
    const active = this.#active;
    if (!active) return null;
    this.#active = null;
    try {
      await active.driver.close(active.handle);
    } finally {
      await active.tunnel.close();
    }
    return active.profile;
  }

  async status() {
    if (!this.#active) return { connected: false };
    const { profile, driver, handle, tunnel, connectedAt } = this.#active;
    let serverVersion = null;
    let error;
    try {
      serverVersion = await driver.serverVersion(handle);
    } catch (e) {
      error = e.message;
    }
    return {
      connected: true,
      profile: profile.id,
      engine: profile.engine,
      readOnly: profile.readOnly,
      tunnel: profile.tunnel?.type ?? null,
      endpoint: profile.engine === "duckdb" ? profile.path : tunnel.port ? `${tunnel.host}:${tunnel.port}` : tunnel.host,
      connectedAt: connectedAt.toISOString(),
      serverVersion,
      ...(error ? { error } : {}),
    };
  }
}
