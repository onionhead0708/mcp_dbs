// Merges the profile sources. Each source is { name, load() } where load()
// returns { profiles, skipped } (it may be async). A source that throws is
// reported in `errors` and does not stop the others.

export class Registry {
  #sources;
  #state = null;

  constructor(sources) {
    this.#sources = sources;
  }

  /** Loads every source the first time it is needed. */
  async load() {
    if (!this.#state) this.#state = await this.#loadAll();
    return this.#state;
  }

  /** Forgets the cache and reads the sources again. */
  async reload() {
    this.#state = null;
    return this.load();
  }

  async #loadAll() {
    const byId = new Map();
    const skipped = [];
    const errors = [];
    for (const source of this.#sources) {
      let result;
      try {
        result = await source.load();
      } catch (error) {
        errors.push({ source: source.name, message: error.message });
        continue;
      }
      for (const profile of result.profiles) {
        if (byId.has(profile.id)) {
          skipped.push({ id: profile.id, source: profile.source, reason: "another profile has the same id" });
        } else {
          byId.set(profile.id, profile);
        }
      }
      skipped.push(...result.skipped);
    }
    const profiles = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
    return { profiles, skipped, errors };
  }

  /** Profiles, optionally filtered by engine and/or source. */
  async list({ engine, source } = {}) {
    const state = await this.load();
    const keep = (p) => (!engine || p.engine === engine) && (!source || p.source === source);
    return {
      profiles: state.profiles.filter(keep),
      skipped: state.skipped.filter(keep),
      errors: state.errors.filter((e) => !source || e.source === source),
    };
  }

  /**
   * Finds a profile by its full id. An id without the `<source>:` prefix is
   * accepted when it matches exactly one profile, so ids saved before the
   * prefix existed keep working.
   */
  async get(id) {
    const { profiles, skipped, errors } = await this.load();
    const exact = profiles.find((p) => p.id === id);
    if (exact) return exact;

    const unprefixed = profiles.filter((p) => p.id.slice(p.source.length + 1) === id);
    if (unprefixed.length === 1) return unprefixed[0];
    if (unprefixed.length > 1) {
      throw new Error(`Profile '${id}' is ambiguous: ${unprefixed.map((p) => p.id).join(", ")}`);
    }

    const skip = skipped.find((s) => s.id === id || s.id.slice(s.source.length + 1) === id);
    if (skip) throw new Error(`Profile '${skip.id}' was skipped: ${skip.reason}`);
    const problems = errors.map((e) => `${e.source}: ${e.message}`);
    throw new Error(
      `Profile '${id}' not found.` + (problems.length ? ` Sources that failed to load: ${problems.join("; ")}` : "")
    );
  }
}
