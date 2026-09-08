import { request as playwrightRequest, type FullConfig } from '@playwright/test';

const readinessPath = '/actuator/health/readiness';
const wakeUpTimeoutMs = 4 * 60_000;
const requestTimeoutMs = 15_000;
const retryIntervalMs = 5_000;

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== 'string' || baseURL.length === 0) {
    throw new Error('A URL base da API não foi configurada.');
  }

  const context = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Accept: 'application/json' },
  });
  const deadline = Date.now() + wakeUpTimeoutMs;
  let lastFailure = 'sem resposta';

  try {
    while (Date.now() < deadline) {
      try {
        const response = await context.get(readinessPath, { timeout: requestTimeoutMs });
        if (response.ok()) {
          const body = (await response.json()) as { status?: string };
          if (body.status === 'UP') {
            return;
          }
          lastFailure = `status funcional ${body.status ?? 'desconhecido'}`;
        } else {
          lastFailure = `HTTP ${response.status()}`;
        }
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  } finally {
    await context.dispose();
  }

  throw new Error(
    `A API não ficou pronta em ${wakeUpTimeoutMs / 1_000}s (${baseURL}${readinessPath}): ${lastFailure}`,
  );
}
