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

const releaseNotes =
  process.env.SAFARI_RELEASE_NOTES ||
  "Small fixes and polish to keep saving pages from Safari smooth and reliable.";
const locale = process.env.SAFARI_RELEASE_LOCALE || "en-US";
const buildNumber = process.env.BUILD_NUMBER;
const waitSeconds = Number(process.env.SAFARI_BUILD_WAIT_SECONDS || 3600);
const pollSeconds = Number(process.env.SAFARI_BUILD_POLL_SECONDS || 60);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findVersion() {
  const response = await request(
    "GET",
    apiPath(`/v1/apps/${process.env.ASC_APP_ID}/appStoreVersions`, {
      "filter[platform]": platform,
      "filter[versionString]": process.env.SAFARI_VERSION,
      "fields[appStoreVersions]": "platform,versionString,releaseType,build",
      include: "build",
      limit: "1",
    })
  );
  const version = response.data?.[0];
  if (!version) {
    throw new Error(
      `No macOS App Store Connect version found for ${process.env.SAFARI_VERSION}.`
    );
  }
  return version;
}

async function upsertReleaseNotes(versionId) {
  const existing = await request(
    "GET",
    apiPath(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`, {
      "filter[locale]": locale,
      "fields[appStoreVersionLocalizations]": "locale,whatsNew",
      limit: "1",
    })
  );
  const localization = existing.data?.[0];
  if (localization) {
    await request(
      "PATCH",
      `/v1/appStoreVersionLocalizations/${localization.id}`,
      {
        data: {
          type: "appStoreVersionLocalizations",
          id: localization.id,
          attributes: {
            whatsNew: releaseNotes,
          },
        },
      }
    );
    console.log(`Updated ${locale} release notes.`);
    return;
  }

  await request("POST", "/v1/appStoreVersionLocalizations", {
    data: {
      type: "appStoreVersionLocalizations",
      attributes: {
        locale,
        whatsNew: releaseNotes,
      },
      relationships: {
        appStoreVersion: {
          data: {
            type: "appStoreVersions",
            id: versionId,
          },
        },
      },
    },
  });
  console.log(`Created ${locale} release notes.`);
}

async function setAutomaticRelease(versionId) {
  await request("PATCH", `/v1/appStoreVersions/${versionId}`, {
    data: {
      type: "appStoreVersions",
      id: versionId,
      attributes: {
        releaseType: "AFTER_APPROVAL",
      },
    },
  });
  console.log("Set App Store release type to automatic after approval.");
}

async function listBuilds(processingState) {
  const params = {
    "filter[app]": process.env.ASC_APP_ID,
    "filter[preReleaseVersion.version]": process.env.SAFARI_VERSION,
    "filter[preReleaseVersion.platform]": platform,
    "filter[expired]": "false",
    "filter[processingState]": processingState,
    "fields[builds]":
      "version,uploadedDate,processingState,expired,usesNonExemptEncryption,preReleaseVersion",
    sort: "-uploadedDate",
    limit: "20",
  };
  const response = await request("GET", apiPath("/v1/builds", params));
  return response.data || [];
}

function pickBuild(builds) {
  if (buildNumber) {
    return builds.find((build) => build.attributes?.version === buildNumber);
  }
  return builds[0];
}

async function waitForBuild() {
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    for (const failedState of ["FAILED", "INVALID"]) {
      const failedBuild = pickBuild(await listBuilds(failedState));
      if (failedBuild) {
        throw new Error(
          `App Store Connect marked build ${failedBuild.attributes?.version || failedBuild.id} as ${failedState}. Check the build processing errors before retrying.`
        );
      }
    }

    const validBuild = pickBuild(await listBuilds("VALID"));
    if (validBuild) {
      console.log(
        `Using processed build ${validBuild.attributes.version} (${validBuild.id}).`
      );
      return validBuild;
    }

    const processingBuild = pickBuild(await listBuilds("PROCESSING"));
    if (processingBuild) {
      console.log(
        `Build ${processingBuild.attributes.version} is still processing; waiting ${pollSeconds}s.`
      );
    } else {
      console.log(
        `No processed build for ${process.env.SAFARI_VERSION} yet; waiting ${pollSeconds}s.`
      );
    }
    await sleep(pollSeconds * 1000);
  }

  throw new Error(
    `Timed out waiting for a valid macOS build for ${process.env.SAFARI_VERSION}.`
  );
}

async function attachBuild(versionId, buildId) {
  await request("PATCH", `/v1/builds/${buildId}`, {
    data: {
      type: "builds",
      id: buildId,
      attributes: {
        usesNonExemptEncryption: false,
      },
    },
  });
  await request(
    "PATCH",
    `/v1/appStoreVersions/${versionId}/relationships/build`,
    {
      data: {
        type: "builds",
        id: buildId,
      },
    }
  );
  console.log(`Attached build ${buildId} to App Store version ${versionId}.`);
}

async function findExistingSubmission(versionId) {
  const response = await request(
    "GET",
    apiPath("/v1/reviewSubmissions", {
      "filter[app]": process.env.ASC_APP_ID,
      "filter[platform]": platform,
      "filter[state]":
        "READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES",
      "fields[reviewSubmissions]":
        "platform,state,items,appStoreVersionForReview",
      "fields[reviewSubmissionItems]": "state,appStoreVersion",
      include: "items,appStoreVersionForReview",
      "limit[items]": "50",
      limit: "20",
    })
  );

  return (response.data || []).find((submission) => {
    const directVersion =
      submission.relationships?.appStoreVersionForReview?.data?.id;
    if (directVersion === versionId) {
      return true;
    }
    const itemIds =
      submission.relationships?.items?.data?.map(({ id }) => id) || [];
    return (response.included || []).some(
      (item) =>
        item.type === "reviewSubmissionItems" &&
        itemIds.includes(item.id) &&
        item.relationships?.appStoreVersion?.data?.id === versionId
    );
  });
}

async function submitForReview(versionId) {
  const existing = await findExistingSubmission(versionId);
  if (existing) {
    console.log(
      `App Store version ${process.env.SAFARI_VERSION} is already in review submission ${existing.id} (${existing.attributes?.state}).`
    );
    return;
  }

  const submission = await request("POST", "/v1/reviewSubmissions", {
    data: {
      type: "reviewSubmissions",
      attributes: {
        platform,
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

  await request("POST", "/v1/reviewSubmissionItems", {
    data: {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: {
          data: {
            type: "reviewSubmissions",
            id: submission.data.id,
          },
        },
        appStoreVersion: {
          data: {
            type: "appStoreVersions",
            id: versionId,
          },
        },
      },
    },
  });

  const submitted = await request(
    "PATCH",
    `/v1/reviewSubmissions/${submission.data.id}`,
    {
      data: {
        type: "reviewSubmissions",
        id: submission.data.id,
        attributes: {
          submitted: true,
        },
      },
    }
  );
  console.log(
    `Submitted Safari version ${process.env.SAFARI_VERSION} for App Review (${submitted.data.attributes?.state}).`
  );
}

const version = await findVersion();
await upsertReleaseNotes(version.id);
await setAutomaticRelease(version.id);
const build = await waitForBuild();
await attachBuild(version.id, build.id);
await submitForReview(version.id);
