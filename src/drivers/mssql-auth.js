// How the SQL Server driver logs in (ADR-5). Each strategy turns a profile
// (and its resolved secret) into tedious's `authentication` option. Only SQL
// logins exist today; Entra (Azure AD) strategies plug in here later without
// touching the driver.

const strategies = {
  /** SQL Server login: user name and password. */
  sql(profile, secret) {
    if (!profile.auth?.user) throw new Error("SQL login needs a user name");
    return { type: "default", options: { userName: profile.auth.user, password: secret ?? "" } };
  },

  // Later, e.g.:
  //   "entra-password":  { type: "azure-active-directory-password", options: { userName, password, clientId, tenantId } }
  //   "entra-default":   { type: "azure-active-directory-default", options: {} }
  //   "entra-sp-secret": { type: "azure-active-directory-service-principal-secret", options: { clientId, clientSecret, tenantId } }
};

/** The strategy name for a profile; `auth.type: "password"` means a SQL login. */
export function strategyName(profile) {
  const type = profile.auth?.type ?? "password";
  return type === "password" ? "sql" : type;
}

/** tedious's `authentication` option for this profile. */
export function authentication(profile, secret) {
  const name = strategyName(profile);
  const strategy = strategies[name];
  if (!strategy) throw new Error(`SQL Server sign-in '${name}' is not supported yet`);
  return strategy(profile, secret);
}
