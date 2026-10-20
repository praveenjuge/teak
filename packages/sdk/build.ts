// Builds the npm package into dist/: a browser ESM bundle, declarations, and
// the manifest, README and LICENSE that `npm pack ./packages/sdk/dist` ships.
// The workspace manifest points at src/ so the monorepo uses the source.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, "src");
const convexRoot = resolve(here, "../convex");
const entry = resolve(sourceRoot, "index.ts");
const output = resolve(here, "dist");
const typesOutput = resolve(output, "types");

// SDK files land at the top of dist/types; the Convex shared modules they
// import land under dist/types/convex with their own relative layout.
const declarationPath = (sourceFile: string) => {
  const base = sourceFile.replace(/\.tsx?$/, ".d.ts");
  if (base.startsWith(`${sourceRoot}/`)) {
    return resolve(typesOutput, relative(sourceRoot, base));
  }
  if (base.startsWith(`${convexRoot}/`)) {
    return resolve(typesOutput, "convex", relative(convexRoot, base));
  }
  throw new Error(`The SDK cannot ship declarations for ${sourceFile}`);
};

const options: ts.CompilerOptions = {
  strict: true,
  declaration: true,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  rootDir: resolve(here, ".."),
  // Resolve Convex modules as source, not as a node_modules library, so
  // their declarations are emitted alongside the SDK's own.
  paths: { "@teak/convex/*": [resolve(convexRoot, "*")] },
  outDir: resolve(output, "unmapped"),
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  skipLibCheck: true,
};

// Declarations must resolve without the monorepo: workspace imports become
// relative paths into dist/types, and every relative path gets `.js`.
const publishedSpecifier = (specifier: string, fromSource: string) => {
  if (specifier.startsWith("@teak/")) {
    const resolved = ts.resolveModuleName(
      specifier,
      fromSource,
      options,
      ts.sys
    ).resolvedModule?.resolvedFileName;
    if (!resolved) {
      throw new Error(`Cannot resolve ${specifier} from ${fromSource}`);
    }
    const target = declarationPath(resolved).replace(/\.d\.ts$/, ".js");
    const path = relative(dirname(declarationPath(fromSource)), target);
    return path.startsWith(".") ? path : `./${path}`;
  }
  if (/^\.{1,2}\//.test(specifier) && !extname(specifier)) {
    return `${specifier}.js`;
  }
  return specifier;
};

const rewriteSpecifiers: ts.TransformerFactory<ts.SourceFile | ts.Bundle> = (
  context
) => {
  let fromSource = "";
  const rewrite = (node: ts.Expression) =>
    ts.isStringLiteral(node)
      ? ts.factory.createStringLiteral(
          publishedSpecifier(node.text, fromSource)
        )
      : node;
  const visit: ts.Visitor = (node) => {
    if (ts.isImportDeclaration(node)) {
      return ts.factory.updateImportDeclaration(
        node,
        node.modifiers,
        node.importClause,
        rewrite(node.moduleSpecifier),
        node.attributes
      );
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      return ts.factory.updateExportDeclaration(
        node,
        node.modifiers,
        node.isTypeOnly,
        node.exportClause,
        rewrite(node.moduleSpecifier),
        node.attributes
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (root) => {
    if (ts.isSourceFile(root)) {
      fromSource = root.fileName;
    }
    return ts.visitEachChild(root, visit, context);
  };
};

rmSync(output, { recursive: true, force: true });

const program = ts.createProgram([entry], options);
const unmapped = resolve(output, "unmapped");
const emitted = program.emit(
  undefined,
  (fileName, text) => {
    const source = resolve(
      options.rootDir as string,
      relative(unmapped, fileName).replace(/\.d\.ts$/, ".ts")
    );
    const target = declarationPath(source);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  },
  undefined,
  true,
  { afterDeclarations: [rewriteSpecifiers] }
);
const diagnostics = [
  ...ts.getPreEmitDiagnostics(program),
  ...emitted.diagnostics,
];
if (emitted.emitSkipped || diagnostics.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    })
  );
}

const bundled = await Bun.build({
  entrypoints: [entry],
  outdir: output,
  naming: "index.js",
  target: "browser",
  format: "esm",
});
if (!bundled.success) {
  throw new AggregateError(bundled.logs, "SDK bundle failed");
}

const workspace = JSON.parse(
  readFileSync(resolve(here, "package.json"), "utf8")
);
const published = {
  name: workspace.name,
  version: workspace.version,
  description: workspace.description,
  repository: workspace.repository,
  license: workspace.license,
  type: workspace.type,
  exports: {
    ".": { types: "./types/index.d.ts", import: "./index.js" },
  },
  publishConfig: workspace.publishConfig,
};
writeFileSync(
  resolve(output, "package.json"),
  `${JSON.stringify(published, null, 2)}\n`
);
for (const file of ["README.md", "LICENSE"]) {
  writeFileSync(resolve(output, file), readFileSync(resolve(here, file)));
}
