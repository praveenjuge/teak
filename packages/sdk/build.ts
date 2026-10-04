import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const source = fileURLToPath(
  new URL("../convex/client/sdk.ts", import.meta.url)
);
const output = fileURLToPath(new URL("./dist/", import.meta.url));
const relativeModule = /^\.{1,2}\//;
const moduleSpecifier = (node: ts.Expression) =>
  ts.isStringLiteral(node) &&
  relativeModule.test(node.text) &&
  !extname(node.text)
    ? ts.factory.createStringLiteral(`${node.text}.js`)
    : node;

// Declaration imports resolve to the emitted .d.ts files under NodeNext as
// well as Bundler resolution. This changes only the distribution's output.
const declarations: ts.TransformerFactory<ts.SourceFile | ts.Bundle> = (
  context
) => {
  const visit: ts.Visitor = (node) => {
    if (ts.isImportDeclaration(node)) {
      return ts.factory.updateImportDeclaration(
        node,
        node.modifiers,
        node.importClause,
        moduleSpecifier(node.moduleSpecifier),
        node.attributes
      );
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      return ts.factory.updateExportDeclaration(
        node,
        node.modifiers,
        node.isTypeOnly,
        node.exportClause,
        moduleSpecifier(node.moduleSpecifier),
        node.attributes
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (root) => ts.visitEachChild(root, visit, context);
};

const program = ts.createProgram([source], {
  strict: true,
  declaration: true,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  rootDir: fileURLToPath(new URL("../convex/", import.meta.url)),
  outDir: `${output}/types`,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  skipLibCheck: true,
});
const emitted = program.emit(undefined, undefined, undefined, true, {
  afterDeclarations: [declarations],
});
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
  entrypoints: [source],
  outdir: output,
  naming: "sdk.js",
  target: "browser",
  format: "esm",
});
if (!bundled.success) {
  throw new AggregateError(bundled.logs, "SDK bundle failed");
}
