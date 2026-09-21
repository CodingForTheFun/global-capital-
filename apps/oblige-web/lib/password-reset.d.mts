export const RESET_SENT_MESSAGE: string;
export const RESET_COOLDOWN_SECONDS: 60;
export const PASSWORD_MIN_LENGTH: 10;
export const PASSWORD_MAX_LENGTH: 200;
export class PasswordResetError extends Error {
  code: string;
  status: number;
  constructor(message: string, code?: string, status?: number);
}
export interface ResetInput {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
}
export interface ResetOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export function validateResetInput(input: Partial<ResetInput>, completing?: boolean): string | null;
export function requestPasswordReset(email: string, options?: ResetOptions): Promise<{ message: string }>;
export function completePasswordReset(input: ResetInput, options?: ResetOptions): Promise<{ ok: true; code: string; message?: string }>;
