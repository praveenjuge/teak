// One signed-URL vector that Convex (Node HMAC) and the Files Worker (WebCrypto)
// must both reproduce.
export const FILE_SIGNING_TEST_VECTOR = {
  secret: "test-signing-secret",
  key: "users/abc/cards/file/x.png",
  exp: "1700000000",
  contentType: "image/png",
  contentDisposition: "inline",
  digest: "f5791c418001f789e1507cfbb9b2be726feef0b7250c29849f5b5e88a6d1a9ce",
} as const;
