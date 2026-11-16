// Opens whatever the profile needs between us and the database, and returns
// the endpoint to connect to. SSH and SSM tunnels arrive in Phase 6.

/** @returns {Promise<{ host, port, tlsServerName, close(): Promise<void> }>} */
export async function openTunnel(profile) {
  if (profile.tunnel) throw new Error(`${profile.tunnel.type} tunnels are not supported yet`);
  if (profile.engine === "duckdb") return { host: null, port: null, tlsServerName: null, close: async () => {} };
  return { host: profile.host, port: profile.port, tlsServerName: profile.host, close: async () => {} };
}
