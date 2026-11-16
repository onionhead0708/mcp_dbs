// The OS password store (ADR-3, ADR-27): Keychain Services on macOS, Secret
// Service on Linux, Credential Manager on Windows, through @napi-rs/keyring,
// which reads the entries DBDelve writes with the Rust `keyring` crate.

/** A reference to one keychain entry. Holds no secret, so it is safe to print. */
export class KeychainSecret {
  constructor(service, account) {
    this.service = service;
    this.account = account;
  }
  get type() {
    return "keychain";
  }
  toJSON() {
    return { type: "keychain", service: this.service, account: this.account };
  }
}

export function keychainSecret(service, account) {
  return new KeychainSecret(service, account);
}

let keyring;

/**
 * Reads one entry: its text, or null when there is none. Throws when the store
 * itself can't be used (locked, no Secret Service, access denied). Loaded
 * lazily, so only `connect` ever touches the keychain (T5.4).
 */
export async function readKeychain(service, account) {
  if (!keyring) {
    try {
      keyring = await import("@napi-rs/keyring");
    } catch (error) {
      throw new Error(`the OS password store can't be used: @napi-rs/keyring did not load (${error.message})`);
    }
  }
  // On Linux, never fall back to the kernel keyring: DBDelve doesn't write there,
  // so a missing Secret Service would look like "no password saved" (ADR-27).
  const options = process.platform === "linux" ? { linux: { store: "secret-service" } } : undefined;
  try {
    // `await`, so a rejected read is caught and reworded here.
    return await new keyring.AsyncEntry(service, account, options).getPassword();
  } catch (error) {
    throw new Error(`cannot read the password for '${account}' from the OS password store (service ${service}): ${error.message}`);
  }
}
