const ADAPTER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const NPM_TIMEOUT_MS = 120_000;

function adapterPackageName(name: string): string {
  if (!ADAPTER_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid adapter name "${name}".`);
  }
  return `@langcost/adapter-${name}`;
}

function summarizeNpmError(stderr: string, stdout: string, exitCode: number | null): string {
  const raw = stderr.trim() || stdout.trim();
  if (!raw) return `npm exited with code ${exitCode ?? "unknown"}`;
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim().length > 0) ?? raw;
  return firstLine.slice(0, 240);
}

async function runNpm(args: string[], packageName: string, action: string): Promise<void> {
  const proc = Bun.spawn(["npm", ...args, "--no-audit", "--no-fund"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, NPM_TIMEOUT_MS);
  timer.unref?.();

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode === 0) return;

    if (timedOut) {
      throw new Error(
        `Failed to ${action} ${packageName}: npm timed out after ${NPM_TIMEOUT_MS / 1000}s.`,
      );
    }

    throw new Error(
      `Failed to ${action} ${packageName}: ${summarizeNpmError(stderr, stdout, exitCode)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function installAdapterPackage(name: string): Promise<void> {
  const packageName = adapterPackageName(name);
  await runNpm(["install", "-g", packageName], packageName, "install");
}

export async function uninstallAdapterPackage(name: string): Promise<void> {
  const packageName = adapterPackageName(name);
  await runNpm(["uninstall", "-g", packageName], packageName, "uninstall");
}
