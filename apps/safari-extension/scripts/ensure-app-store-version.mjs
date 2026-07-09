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
      "fields[appStoreVersions]": "platform,versionString,appStoreState",
      limit: "1",
    })
  );
  return response.data?.[0];
}

async function findEditableVersion() {
  const response = await request(
    "GET",
    apiPath(`/v1/apps/${process.env.ASC_APP_ID}/appStoreVersions`, {
      "filter[platform]": platform,
      "fields[appStoreVersions]": "platform,versionString,appStoreState",
      limit: "20",
    })
  );
  return (response.data || []).find(
    (version) => version.attributes?.appStoreState === "PREPARE_FOR_SUBMISSION"
  );
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

async function updateVersionString(version) {
  const response = await request(
    "PATCH",
    `/v1/appStoreVersions/${version.id}`,
    {
      data: {
        type: "appStoreVersions",
        id: version.id,
        attributes: {
          versionString: process.env.SAFARI_VERSION,
        },
      },
    }
  );
  console.log(
    `Updated editable macOS version ${version.attributes?.versionString} to ${process.env.SAFARI_VERSION} (${version.id}).`
  );
  return response.data;
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
  } else if (error.message.includes("cannot create a new version of the App")) {
    const editableVersion = await findEditableVersion();
    if (!editableVersion) {
      throw new Error(
        `App Store Connect cannot create macOS version ${process.env.SAFARI_VERSION}, and no editable macOS version is available to reuse.`
      );
    }
    await updateVersionString(editableVersion);
  } else {
    throw error;
  }
}
