export const POLAR_PLAN_IDS = {
  development: {
    monthly: "a02153cd-c49d-49ae-8be6-464296a39a23",
    yearly: "f3073c34-8b4d-40b7-8123-2f8cbacbc609",
  },
  production: {
    monthly: "d46c71a7-61dc-4dc8-b53d-9a73d0204c28",
    yearly: "6fb24b68-09e0-42c4-b090-f0e03cb7de56",
  },
} as const;

export function getPolarPlanIds(environment: "development" | "production") {
  return POLAR_PLAN_IDS[environment];
}
