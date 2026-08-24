// Ambient declarations for .wasm imports. Resolution differs per runtime:
//  - Wrangler (deployed worker): statically imported .wasm files are compiled
//    at build time and handed over as ready-to-use WebAssembly.Modules
//    (workerd forbids runtime code generation).
//  - Bun (unit tests): the import resolves to the file's absolute path, which
//    src/wasm.ts reads and compiles. That branch never runs in production.
declare module "*.wasm" {
  const contents: WebAssembly.Module | string;
  export default contents;
}
