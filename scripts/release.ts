#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

type PackageInfo = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type ReleasePackage = {
  dir: string;
  access: "public" | "restricted";
};

const root = resolve(import.meta.dir, "..");
const npmCache = process.env.NPM_CONFIG_CACHE ?? "/tmp/langcost-npm-cache";

const packages: ReleasePackage[] = [
  { dir: "packages/core", access: "public" },
  { dir: "packages/db", access: "public" },
  { dir: "packages/analyzers", access: "public" },
  { dir: "packages/adapter-openclaw", access: "public" },
  { dir: "packages/adapter-claude-code", access: "public" },
  { dir: "packages/adapter-cline", access: "public" },
  { dir: "packages/adapter-warp", access: "public" },
  { dir: "packages/adapter-codex", access: "public" },
  { dir: "packages/cli", access: "public" },
];

const args = new Set(Bun.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipChecks = args.has("--skip-checks");
const keepTarballs = args.has("--keep-tarballs");
const forcePublish = args.has("--force-publish");
const tag = getArgValue("--tag") ?? "latest";
const fixedOtp = getArgValue("--otp") ?? process.env.NPM_CONFIG_OTP;

function getArgValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return Bun.argv
    .slice(2)
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

function run(command: string[], cwd = root, stdio: "pipe" | "inherit" = "pipe"): string {
  console.log(`$ ${command.join(" ")}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: stdio === "inherit" ? "inherit" : ["inherit", "pipe", "pipe"],
  });

  if (stdio === "pipe" && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (stdio === "pipe" && result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }

  return result.stdout;
}

async function readPackageJson(packageDir: string): Promise<PackageInfo> {
  return Bun.file(join(root, packageDir, "package.json")).json();
}

async function main() {
  mkdirSync(npmCache, { recursive: true });

  const rootPackage = await Bun.file(join(root, "package.json")).json();
  const version = rootPackage.version;
  const packageInfos = await Promise.all(
    packages.map(async (pkg) => ({
      ...pkg,
      manifest: await readPackageJson(pkg.dir),
    })),
  );

  for (const pkg of packageInfos) {
    if (pkg.manifest.version !== version) {
      throw new Error(`${pkg.manifest.name} is ${pkg.manifest.version}, expected ${version}`);
    }
  }

  if (!skipChecks) {
    run(["bun", "install", "--frozen-lockfile"]);
    run(["bun", "test"]);
    run(["bun", "run", "typecheck"]);
    run(["bun", "run", "lint"]);
  }

  for (const pkg of packageInfos) {
    if (!dryRun && !forcePublish && packageVersionExists(pkg.manifest.name, version)) {
      console.log(`\n=== Skipping ${pkg.manifest.name}@${version}; already published ===`);
      continue;
    }

    console.log(`\n=== Packing ${pkg.manifest.name}@${pkg.manifest.version} ===`);
    const packageDir = join(root, pkg.dir);
    if (pkg.manifest.scripts?.build) {
      console.log(`\n=== Building ${pkg.manifest.name}@${pkg.manifest.version} ===`);
      run(["bun", "run", "build"], packageDir, "inherit");
    }
    const packOutput = run(["bun", "pm", "pack"], packageDir);
    const tarballName = packOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.endsWith(".tgz"));

    if (!tarballName) {
      throw new Error(`Could not find tarball name in pack output for ${pkg.manifest.name}`);
    }

    const tarballPath = join(packageDir, tarballName);
    try {
      verifyPackedManifest(tarballPath, pkg.manifest.name, version);

      const publishCommand = [
        "npm",
        "--cache",
        npmCache,
        "publish",
        tarballPath,
        "--access",
        pkg.access,
        "--tag",
        tag,
      ];

      if (dryRun) {
        publishCommand.push("--dry-run");
      }
      if (fixedOtp) {
        publishCommand.push(`--otp=${fixedOtp}`);
      }

      console.log(`\n=== Publishing ${pkg.manifest.name}@${version} ===`);
      run(publishCommand, root, "inherit");
    } finally {
      if (!keepTarballs && existsSync(tarballPath)) {
        rmSync(tarballPath);
      }
    }
  }

  console.log("\n=== Release complete ===");
}

function packageVersionExists(packageName: string, version: string): boolean {
  const spec = `${packageName}@${version}`;
  console.log(`$ npm --cache ${npmCache} view ${spec} version`);
  const result = spawnSync("npm", ["--cache", npmCache, "view", spec, "version"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.status === 0) {
    const publishedVersion = result.stdout.trim();
    if (publishedVersion === version) {
      return true;
    }
    throw new Error(`Unexpected npm view result for ${spec}: ${publishedVersion}`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes("E404") || output.includes("404 Not Found")) {
    return false;
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  throw new Error(`Could not check whether ${spec} is already published`);
}

function verifyPackedManifest(tarballPath: string, packageName: string, version: string) {
  const packedManifestText = run(["tar", "-xOf", tarballPath, "package/package.json"]);
  const packedManifest = JSON.parse(packedManifestText) as PackageInfo;

  if (packedManifest.name !== packageName) {
    throw new Error(`Packed manifest name mismatch: ${packedManifest.name} !== ${packageName}`);
  }
  if (packedManifest.version !== version) {
    throw new Error(
      `Packed manifest version mismatch for ${packageName}: ${packedManifest.version} !== ${version}`,
    );
  }

  for (const [dependency, range] of Object.entries(packedManifest.dependencies ?? {})) {
    if (range.startsWith("workspace:")) {
      throw new Error(`${packageName} still contains workspace dependency ${dependency}`);
    }
    if (dependency.startsWith("@langcost/") && range !== version) {
      throw new Error(`${packageName} depends on ${dependency}@${range}, expected ${version}`);
    }
  }
}

main().catch((error) => {
  console.error(`\nRelease failed: ${error.message}`);
  process.exit(1);
});
