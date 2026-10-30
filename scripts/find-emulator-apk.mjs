import { appendFileSync } from 'node:fs';

// The versioned artifact name is the build recipe contract: bump its version
// when the emulator ABI, API URL, environment or provider/manifest config changes.
const repository = process.env.GITHUB_REPOSITORY;
const name = process.env.EMULATOR_ARTIFACT_NAME;
if (!repository || !name || !process.env.GITHUB_TOKEN || !process.env.GITHUB_OUTPUT) throw new Error('GitHub artifact lookup environment missing');
const url = `https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=10`;
const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
if (!response.ok) {
  console.log(`Previous APK lookup unavailable (${response.status}); compile a fresh isolated APK.`);
} else {
  const { artifacts } = await response.json();
  const candidate = artifacts.find(artifact => !artifact.expired && String(artifact.workflow_run?.id) !== process.env.GITHUB_RUN_ID);
  if (candidate) {
    appendFileSync(process.env.GITHUB_OUTPUT, `run_id=${candidate.workflow_run.id}\n`);
    console.log(`Reusing versioned emulator artifact ${candidate.id}; source and checksum will be verified before use.`);
  }
}
