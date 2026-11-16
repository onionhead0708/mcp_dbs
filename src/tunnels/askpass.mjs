// SSH_ASKPASS helper (T6.2): ssh runs this to ask for a key's passphrase.
// The passphrase comes from the environment ssh inherited from mcp-dbs, never
// from the command line. Anything other than a passphrase prompt (a host key
// question, a password prompt) is refused, so it can never answer those.
const prompt = process.argv.slice(2).join(" ");
const secret = process.env.MCP_DBS_ASKPASS_SECRET;
if (!secret || !/passphrase/i.test(prompt)) process.exit(1);
process.stdout.write(`${secret}\n`);
