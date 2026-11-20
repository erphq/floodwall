// An example agent: rolls out a new image to a few services, asking the
// plane before each change and reporting how it went.
//
//   FLOODWALL_KEY=fw_test_... FLOODWALL_PLANE=<plane id> node sdk/examples/deploy-agent.mjs v42
//
// It only prints what it would run; swap `apply` for your real deploy. Without
// FLOODWALL_KEY it prints the changes it would ask the plane about, and stops.

import { Floodwall, NotAdmitted } from "../typescript/src/index.js";

const image = process.argv[2] ?? "v1";
const changes = ["web", "api", "billing"].map((service) => ({
  service,
  change: { action: { kind: "apply", resource: service, manifest: image }, priority: "normal", blastRadius: "service" },
}));

if (!process.env.FLOODWALL_KEY) {
  console.log("FLOODWALL_KEY is not set, so no plane is asked. The changes would be:");
  for (const { change } of changes) console.log(JSON.stringify(change));
  process.exit(0);
}

const fw = new Floodwall({
  apiKey: process.env.FLOODWALL_KEY,
  plane: process.env.FLOODWALL_PLANE,
  agent: process.env.FLOODWALL_AGENT ?? "deploy-agent",
  baseUrl: process.env.FLOODWALL_URL,
});

for (const { service, change } of changes) {
  try {
    await fw.guard(change, async () => {
      console.log(`applying ${image} to ${service}`);
      // e.g. await exec(`kubectl set image deploy/${service} app=registry/app:${image}`)
    }, { timeoutSeconds: 120 });
    console.log(`${service}: done`);
  } catch (error) {
    if (error instanceof NotAdmitted) {
      console.log(`${service}: not admitted (${error.decision.status}${error.decision.reason ? `: ${error.decision.reason}` : ""})`);
    } else {
      throw error;
    }
  }
}
