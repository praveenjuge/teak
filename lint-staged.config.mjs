const STAGED_FILE_GLOB = "*.{js,jsx,ts,tsx,json,jsonc,css,md,mdx}";

export default {
  [STAGED_FILE_GLOB]: (files) => {
    if (files.length === 0) {
      return [];
    }

    const escapedFiles = files.map((file) => JSON.stringify(file)).join(" ");
    return `bun x ultracite fix ${escapedFiles}`;
  },
};
