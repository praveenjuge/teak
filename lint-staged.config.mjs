const STAGED_FILE_GLOB = "*.{js,jsx,ts,tsx,json,jsonc,css,md,mdx}";

export default {
  [STAGED_FILE_GLOB]: (files) => {
    if (files.length === 0) {
      return [];
    }

    const raycastFiles = files.filter((file) => file.includes("/apps/raycast/"));
    const nonRaycastFiles = files.filter(
      (file) => !file.includes("/apps/raycast/")
    );

    const commands = [];

    if (nonRaycastFiles.length > 0) {
      commands.push(`bun x ultracite fix ${nonRaycastFiles.join(" ")}`);
    }

    if (raycastFiles.length > 0) {
      commands.push(`bunx prettier@3.8.1 --write ${raycastFiles.join(" ")}`);
    }

    return commands;
  },
};
