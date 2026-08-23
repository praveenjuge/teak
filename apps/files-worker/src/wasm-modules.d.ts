// Ambient declarations for .wasm imports. Resolution differs per runtime:
//  - Wrangler (deployed worker): the Data rule in wrangler.jsonc hands each
//    import through as an ArrayBuffer of the file contents.
//  - Bun (unit tests): the import resolves to the file's absolute path, which
//    src/wasm.ts reads from disk. That branch never runs in production.
declare module "*.wasm" {
  const contents: ArrayBuffer | string;
  export default contents;
}
