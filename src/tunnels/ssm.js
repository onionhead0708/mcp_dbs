// AWS SSM port forwarding (T6.6): `aws ssm start-session` with the
// AWS-StartPortForwardingSessionToRemoteHost document. The aws CLI starts
// session-manager-plugin, which opens the local port.
import path from "node:path";
import { startProcess } from "./process.js";

export function ssmArgs(tunnel, remote, localPort) {
  const args = [
    "ssm", "start-session",
    "--target", tunnel.target,
    "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters", JSON.stringify({ host: [remote.host], portNumber: [String(remote.port)], localPortNumber: [String(localPort)] }),
  ];
  if (tunnel.awsProfile) args.push("--profile", tunnel.awsProfile);
  if (tunnel.region) args.push("--region", tunnel.region);
  return args;
}

/** An SSM failure, said in words a user can act on. */
export function explainSsmFailure(log, tunnel) {
  const last = log.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
  if (/SessionManagerPlugin is not found|session-manager-plugin.*not found/i.test(log)) {
    return "The AWS Session Manager plugin is not installed or not on the PATH. Install it, or set its path in the DBDelve profile.";
  }
  if (/ENOENT/.test(log)) return `The AWS CLI was not found (${tunnel.awsCli ?? "aws"}). Install it, or set its path in the DBDelve profile.`;
  if (/ExpiredToken|InvalidClientTokenId|UnrecognizedClient|Unable to locate credentials|SSO.*(expired|login)|Token has expired/i.test(log)) {
    return `AWS credentials are missing or expired${tunnel.awsProfile ? ` for profile ${tunnel.awsProfile}` : ""}. Sign in again (e.g. \`aws sso login${tunnel.awsProfile ? ` --profile ${tunnel.awsProfile}` : ""}\`) and connect again. AWS said: ${last}`;
  }
  if (/TargetNotConnected/i.test(log)) return `The SSM target ${tunnel.target} is not connected to Session Manager. AWS said: ${last}`;
  if (/AccessDenied/i.test(log)) return `AWS refused the SSM session to ${tunnel.target}: ${last}`;
  return `SSM session to ${tunnel.target} failed: ${last || "aws exited without saying why"}`;
}

export function startSsm(tunnel, remote, localPort) {
  const env = { ...process.env };
  // The plugin is found on the PATH; a profile can name where it is.
  if (tunnel.pluginPath) env.PATH = `${path.dirname(tunnel.pluginPath)}${path.delimiter}${env.PATH ?? ""}`;
  const child = startProcess(tunnel.awsCli ?? "aws", ssmArgs(tunnel, remote, localPort), { env });
  return { child, ready: /Waiting for connections/, explain: (log) => explainSsmFailure(log, tunnel) };
}
