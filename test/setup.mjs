// Loaded into every test process (see "test" in package.json): keep the
// server's info log out of test output unless asked for.
process.env.MCP_DBS_LOG ??= "warn";
