import 'server-only';
import { APIError, APITimeoutError, TypeSafeClient, choice, type Fetch } from '@typesafe-ai/sdk';

// Explicit endpoint and logging policy prevent environment overrides from
// redirecting the credential or logging research inputs.
export function createTypeSafeClient(apiKey = process.env.TYPESAFE_API_KEY, fetchImpl?: Fetch) {
  if (!apiKey?.trim()) return null;
  return new TypeSafeClient({
    apiKey: apiKey.trim(),
    baseURL: 'https://api.typesafe.ai',
    defaultModel: 'jev-latest',
    timeout: 8000,
    retry: { maxRetries: 0 },
    logLevel: 'off',
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export type TypeSafeConnection = {
  status: 'connected' | 'not_configured' | 'authentication_failed' | 'rate_limited' | 'timeout' | 'invalid_response' | 'unavailable';
};

// One tiny synthetic request: never send account data, props, or secrets as state.
// Connectivity is not evidence of validated sports prediction performance.
export async function verifyTypeSafeConnection(client?: TypeSafeClient | null): Promise<TypeSafeConnection> {
  try {
    const activeClient = client === undefined ? createTypeSafeClient() : client;
    if (!activeClient) return { status: 'not_configured' };
    const response = await activeClient.systemOne({
      state: { message: 'This is an Oblige Props connection test.' },
      questions: {
        purpose: choice('What is the stated purpose of the message?', {
          connection_test: 'Testing a software connection',
          other: 'Any other purpose',
        }),
      },
    });
    const answer = response.answers?.purpose;
    if (answer?.type !== 'choice' || answer.choice !== 'connection_test') {
      return { status: 'invalid_response' };
    }
    return { status: 'connected' };
  } catch (error) {
    // Do not return/log raw SDK errors: upstream bodies can contain request data.
    if (error instanceof APITimeoutError) return { status: 'timeout' };
    if (error instanceof APIError && [401, 403].includes(error.status)) return { status: 'authentication_failed' };
    if (error instanceof APIError && error.status === 429) return { status: 'rate_limited' };
    return { status: 'unavailable' };
  }
}

let startupCheck: Promise<TypeSafeConnection> | undefined;
export function verifyTypeSafeOnce() {
  return startupCheck ??= verifyTypeSafeConnection();
}
