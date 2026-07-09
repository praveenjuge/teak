import {
  apiPath,
  platform,
  request,
  requireEnv,
} from "./app-store-connect-api.mjs";

requireEnv([
  "ASC_APP_ID",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY_ID",
  "APPLE_API_KEY_PATH",
  "SAFARI_VERSION",
]);

async function findVersion() {
  const response = await request(
    "GET",
    apiPath(`/v1/apps/${process.env.ASC_APP_ID}/appStoreVersions`, {
      "filter[platform]": platform,
      "filter[versionString]": process.env.SAFARI_VERSION,
      limit: "1",
    })
  );
  return response.data?.[0];
}

function createVersion() {
  return request("POST", "/v1/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: {
        platform,
        versionString: process.env.SAFARI_VERSION,
      },
      relationships: {
        app: {
          data: {
            type: "apps",
            id: process.env.ASC_APP_ID,
          },
        },
      },
    },
  });
}

let version = await findVersion();
if (version) {
  console.log(
    `App Store Connect already has macOS version ${process.env.SAFARI_VERSION} (${version.id}).`
  );
  process.exit(0);
}

try {
  version = await createVersion();
  console.log(
    `Created App Store Connect macOS version ${process.env.SAFARI_VERSION} (${version.data.id}).`
  );
} catch (error) {
  if (error.statusCode !== 409) {
    throw error;
  }

  version = await findVersion();
  if (version) {
    console.log(
      `App Store Connect macOS version ${process.env.SAFARI_VERSION} exists after conflict (${version.id}).`
    );
  } else if (
    error.message.includes(
      "cannot create a new version of the App in the current state"
    )
  ) {
    console.log(
      `App Store Connect cannot create macOS version ${process.env.SAFARI_VERSION} in the current app state. Continuing with build upload.`
    );
  } else {
    throw error;
  }
}
