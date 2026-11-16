// Secrets are carried in a profile as references and only turned into text
// when `connect` runs. The value lives in a private field, so it never shows
// up in JSON.stringify, util.inspect or an error message built from a profile.

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

/** Returns the secret's text, or undefined when there is no reference. */
export async function resolveSecret(ref) {
  if (ref == null) return undefined;
  if (ref instanceof InlineSecret) return ref.reveal();
  throw new Error(`Unsupported secret reference: ${ref.type ?? typeof ref}`);
}
