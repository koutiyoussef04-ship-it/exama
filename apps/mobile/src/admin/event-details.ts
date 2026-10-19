/**
 * The "Details" cell of a customer's Recent events: only the properties that help diagnose a problem, as `key: value`.
 * A fixed allow-list on purpose — new event properties are not shown until someone decides they are safe and useful.
 */
const SHOWN = ['platform', 'failure_reason', 'file_size_kb'] as const;

export function eventDetails(properties: Record<string, unknown> | null | undefined): string {
  if (!properties) return '';
  return SHOWN.flatMap((key) => {
    const v = properties[key];
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? [`${key}: ${String(v).slice(0, 40)}`] : [];
  }).join(', ');
}
