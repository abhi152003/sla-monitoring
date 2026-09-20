/** Structured logs: identifiers, transitions, durations, counts — never bodies, URLs, or secrets. */
export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }));
}
