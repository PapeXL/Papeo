import path from "node:path";
import os from "node:os";
import { app } from "electron";
import { FORK_CLI_NAME } from "../../fork-identity.js";

export function getLocalBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

export function getCliTargetPath(): string {
  // Fork build: a stock Paseo install owns ~/.local/bin/paseo, so claim our own name.
  const filename = process.platform === "win32" ? `${FORK_CLI_NAME}.cmd` : FORK_CLI_NAME;
  return path.join(getLocalBinDir(), filename);
}

export function getBundledCliShimPath(): string {
  const cliShimFilename = process.platform === "win32" ? `${FORK_CLI_NAME}.cmd` : FORK_CLI_NAME;

  if (process.platform === "darwin") {
    const electronExePath = app.getPath("exe");
    const appBundle = electronExePath.replace(/\/Contents\/MacOS\/.+$/, "");
    return path.join(appBundle, "Contents", "Resources", "bin", cliShimFilename);
  }

  if (process.platform === "win32") {
    const electronExePath = app.getPath("exe");
    return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
  }

  // Linux
  const electronExePath = app.getPath("exe");
  return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
}
