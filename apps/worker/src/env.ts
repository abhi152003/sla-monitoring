export interface WorkerEnv {
  DATABASE_URL?: string;
  ALLOWED_ORIGIN?: string;
}

let env: WorkerEnv = {};

/** Called once per request by the router; also set directly in tests and scripts. */
export function setEnv(next: WorkerEnv): void {
  env = next;
}

export function getEnv(): WorkerEnv {
  return env;
}
