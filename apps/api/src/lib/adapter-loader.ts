import type { IAdapter } from "@langcost/core";

export type AdapterInstallType = "npm" | "workspace";

export interface LoadedAdapter {
  adapter: IAdapter;
  installType: AdapterInstallType;
}

async function importModule(specifier: string) {
  return import(specifier);
}

async function importInstalledAdapter(name: string): Promise<IAdapter | null> {
  const packageName = `@langcost/adapter-${name}`;
  try {
    const module = await importModule(packageName);
    const adapter = module.default as IAdapter | undefined;
    return adapter ?? null;
  } catch {
    return null;
  }
}

async function importWorkspaceAdapter(name: string): Promise<IAdapter | null> {
  try {
    const module = await importModule(
      new URL(`../../../../packages/adapter-${name}/src/index.ts`, import.meta.url).href,
    );
    const adapter = module.default as IAdapter | undefined;
    return adapter ?? null;
  } catch {
    return null;
  }
}

export async function tryLoadAdapterWithSource(name: string): Promise<LoadedAdapter | null> {
  const fromNpm = await importInstalledAdapter(name);
  if (fromNpm) return { adapter: fromNpm, installType: "npm" };
  const fromWorkspace = await importWorkspaceAdapter(name);
  if (fromWorkspace) return { adapter: fromWorkspace, installType: "workspace" };
  return null;
}

export async function tryLoadAdapter(name: string): Promise<IAdapter | null> {
  const loaded = await tryLoadAdapterWithSource(name);
  return loaded?.adapter ?? null;
}

export async function loadAdapter(name: string): Promise<IAdapter> {
  const adapter = await tryLoadAdapter(name);
  if (adapter) return adapter;

  const packageName = `@langcost/adapter-${name}`;
  throw new Error(`Adapter "${name}" not found.\nInstall it: npm install ${packageName}`);
}
