export function createClientCorrelationId() {
  return crypto.randomUUID();
}
