import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

const sdkRoot = process.env.PI_SDK_ROOT;
if (!sdkRoot) {
  throw new Error("PI_SDK_ROOT must point to an installed @earendil-works/pi-coding-agent package");
}

const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const { ModelRuntime, createAgentSessionServices } = sdk;

const root = await mkdtemp(join(tmpdir(), "pipilot-pi-sdk-spike-"));
const agentDir = join(root, "agent");
const cwdA = join(root, "workspace-a");
const cwdB = join(root, "workspace-b");
const extensionPath = join(root, "lag-extension.mjs");

await Promise.all([
  mkdir(agentDir, { recursive: true }),
  mkdir(cwdA, { recursive: true }),
  mkdir(cwdB, { recursive: true }),
]);

await writeFile(
  extensionPath,
  `
globalThis.__pipilotModuleImports = (globalThis.__pipilotModuleImports ?? 0) + 1;
export default async function extensionFactory(pi) {
  globalThis.__pipilotFactoryRuns = (globalThis.__pipilotFactoryRuns ?? 0) + 1;
  await new Promise((resolve) => setTimeout(resolve, 120));
  pi.registerCommand("cache-spike", { description: "isolated benchmark command", handler() {} });
}
`,
  "utf8",
);

const modelRuntime = await ModelRuntime.create({
  authPath: join(agentDir, "auth.json"),
  modelsPath: join(agentDir, "models.json"),
});

async function createServices(label, cwd) {
  const start = performance.now();
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime,
    resourceLoaderOptions: {
      additionalExtensionPaths: [extensionPath],
      noContextFiles: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
    },
  });
  const elapsedMs = performance.now() - start;
  const errors = services.resourceLoader.getExtensions().errors;
  if (errors.length > 0) {
    throw new Error(`${label} extension load failed: ${JSON.stringify(errors)}`);
  }
  return {
    label,
    cwd,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    moduleImports: globalThis.__pipilotModuleImports ?? 0,
    factoryRuns: globalThis.__pipilotFactoryRuns ?? 0,
  };
}

try {
  const results = [];
  results.push(await createServices("A first", cwdA));
  results.push(await createServices("A second", cwdA));
  results.push(await createServices("B first", cwdB));
  results.push(await createServices("A after B", cwdA));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
  delete globalThis.__pipilotModuleImports;
  delete globalThis.__pipilotFactoryRuns;
}
