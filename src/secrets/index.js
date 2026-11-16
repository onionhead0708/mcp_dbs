// Secrets are carried in a profile as references and only turned into text
// when `connect` runs (ADR-16). The value of an inline secret lives in a
// private field, so it never shows up in JSON.stringify, util.inspect or an
// error message built from a profile.
import { KeychainSecret, readKeychain as defaultReadKeychain } from "./keychain.js";

export { KeychainSecret, keychainSecret } from "./keychain.js";

export class InlineSecret {
  #value;
  constructor(value) {
    this.#value = value;
  }
  get type() {
    return "inline";
  }
  reveal() {
    return this.#value;
  }
  toJSON() {
    return { type: "inline" };
  }
}

export function inlineSecret(value) {
  return new InlineSecret(value);
}

/**
 * The secret's text; null when the reference points at nothing saved (a
 * keychain entry that doesn't exist); undefined when there is no reference.
 * `readKeychain` can be replaced in tests.
 */
export async function resolveSecret(ref, { readKeychain = defaultReadKeychain } = {}) {
  if (ref == null) return undefined;
  if (ref instanceof InlineSecret) return ref.reveal();
  if (ref instanceof KeychainSecret) {
    const value = await readKeychain(ref.service, ref.account);
    return value ?? null;
  }
  throw new Error(`Unsupported secret reference: ${ref.type ?? typeof ref}`);
}
