// SSH tunnels through the system `ssh` (T6.2), the way DBDelve opens them, so
// ~/.ssh/config, the agent and hardware keys all work. Keys only (ADR-11).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startProcess } from "./process.js";

const windows = process.platform === "win32";

/** Windows' built-in OpenSSH when it is there, else `ssh` on the PATH. */
export function sshBinary(env = process.env) {
  if (windows) {
    const builtIn = path.join(env.SystemRoot || "C:\\Windows", "System32", "OpenSSH", "ssh.exe");
    if (fs.existsSync(builtIn)) return builtIn;
  }
  return "ssh";
}

/**
 * ssh's arguments. `-v` makes ssh say when the forward is listening, which is
 * how we know the tunnel is ready. Host keys are checked as the user's ssh
 * config says; nothing here turns checking off (T6.4).
 */
export function sshArgs(tunnel, remote, localPort, { withSecret, configFile = null }) {
  const args = [
    // MCP_DBS_SSH_CONFIG: an ssh config file to use instead of ~/.ssh/config.
    ...(configFile ? ["-F", configFile] : []),
    "-N",
    "-v",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    // Keys or the agent only (ADR-11): never a password or keyboard prompt.
    "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no",
    // Without a passphrase to give, ssh must never wait for one (T6.2).
    "-o", `BatchMode=${withSecret ? "no" : "yes"}`,
    "-L", `127.0.0.1:${localPort}:${remote.host}:${remote.port}`,
  ];
  if (tunnel.port) args.push("-p", String(tunnel.port));
  if (tunnel.identityFile) args.push("-i", tunnel.identityFile);
  args.push(tunnel.user ? `${tunnel.user}@${tunnel.host}` : tunnel.host);
  return args;
}

let askpassPath;

/**
 * A small executable ssh can run as SSH_ASKPASS: a shell or cmd wrapper
 * around askpass.mjs, written once to a private temp folder.
 */
export function askpassProgram() {
  if (askpassPath && fs.existsSync(askpassPath)) return askpassPath;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-dbs-askpass-"));
  fs.chmodSync(dir, 0o700);
  const script = fileURLToPath(new URL("./askpass.mjs", import.meta.url));
  if (windows) {
    askpassPath = path.join(dir, "askpass.cmd");
    fs.writeFileSync(askpassPath, `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    askpassPath = path.join(dir, "askpass.sh");
    const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(askpassPath, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o700 });
  }
  process.once("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  return askpassPath;
}

/** ssh's last words, without its -v chatter. */
function complaint(log) {
  return log
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^debug\d:/.test(line) && !/^(OpenSSH|Authenticated|Transferred|Pseudo)/.test(line))
    .slice(-4)
    .join(" ")
    .trim();
}

/** An ssh failure, said in words a user can act on. */
export function explainSshFailure(log, tunnel, { withSecret = false } = {}) {
  const target = `${tunnel.user ? `${tunnel.user}@` : ""}${tunnel.host}`;
  const command = `ssh ${tunnel.port ? `-p ${tunnel.port} ` : ""}${target}`;
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No .* host key is known/i.test(log)) {
    return `The SSH host key for ${tunnel.host} is not known, or has changed. Run \`${command}\` once in a terminal to check and accept it, then connect again.`;
  }
  if (/bad passphrase|incorrect passphrase|load key .*: (incorrect|bad)/i.test(log)) {
    return `The passphrase for the SSH key did not work (${complaint(log)}). Check the passphrase saved for this profile.`;
  }
  // The server would take the key, but ssh couldn't unlock it.
  if (/Server accepts key/i.test(log) && /Permission denied/i.test(log)) {
    return withSecret
      ? "The SSH key's passphrase did not unlock it. Check the passphrase saved for this profile."
      : "The SSH key needs a passphrase, and none is saved for this profile. Save it (in DBDelve, or as the SSH tunnel's password in DBeaver), or load the key into ssh-agent.";
  }
  if (/Permission denied/i.test(log)) {
    return `SSH login to ${target} was refused (${complaint(log)}). Only keys and ssh-agent are used; check that \`${command}\` logs in without a password.`;
  }
  if (/Could not resolve hostname|Connection refused|timed out|No route to host|Network is unreachable/i.test(log)) {
    return `Cannot reach the SSH host ${tunnel.host}: ${complaint(log)}`;
  }
  if (/forwarding failed|cannot listen|Address already in use/i.test(log)) {
    return `The SSH port forward could not be set up: ${complaint(log)}`;
  }
  return `SSH tunnel through ${target} failed: ${complaint(log) || "ssh exited without saying why"}`;
}

/**
 * Starts ssh. Ready when ssh says the local forward is listening; it reports
 * that only after logging in.
 */
export function startSsh(tunnel, remote, localPort, { passphrase }) {
  const withSecret = Boolean(passphrase);
  const env = { ...process.env };
  delete env.MCP_DBS_ASKPASS_SECRET;
  if (withSecret) {
    env.SSH_ASKPASS = askpassProgram();
    env.SSH_ASKPASS_REQUIRE = "force";
    env.MCP_DBS_ASKPASS_SECRET = passphrase;
    // Some ssh builds want DISPLAY set before they use SSH_ASKPASS at all.
    env.DISPLAY = env.DISPLAY || ":0";
  }
  const configFile = env.MCP_DBS_SSH_CONFIG || null;
  const child = startProcess(sshBinary(), sshArgs(tunnel, remote, localPort, { withSecret, configFile }), { env });
  return {
    child,
    ready: new RegExp(`Local forwarding listening on 127\\.0\\.0\\.1 port ${localPort}\\b`),
    explain: (log) => explainSshFailure(log, tunnel, { withSecret }),
  };
}
