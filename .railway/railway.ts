import { defineRailway, project, service } from "railway/iac";

export const partial = "oblige-web-builder-recovery";

export default defineRailway(() => {
  const web = service("oblige-web", {
    replicas: {
      "us-west2": 1,
    },
  });

  return project("AutoProp Scout Pro", {
    resources: [web],
  });
});
