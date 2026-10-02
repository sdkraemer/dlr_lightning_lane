export const PARKS = [
  { id: '7340550b-c14d-4def-80bb-acdb51d49a66', name: 'Disneyland Park' },
  { id: '832fcd51-ea19-4e77-85c7-75d5843b127c', name: 'Disney California Adventure' },
];
export type LiveEntity = {
  id: string; name: string; entityType: string; status: string;
  lastUpdated?: string;
  queue?: Record<string, Record<string, unknown> | null> | null;
};

export async function fetchLive(parkId: string): Promise<LiveEntity[]> {
  const response = await fetch(`https://api.themeparks.wiki/v1/entity/${parkId}/live`, {
    signal: AbortSignal.timeout(20_000),
    headers: { 'User-Agent': 'personal-dlr-monitor/0.1', Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}; Retry-After=${response.headers.get('retry-after') ?? 'absent'}`);
  const body = await response.json() as { liveData?: LiveEntity[] };
  if (!Array.isArray(body.liveData)) throw new Error('Response has no liveData array');
  const entities = body.liveData.filter(e => e.entityType === 'ATTRACTION');
  for (const e of entities) {
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.status !== 'string')
      throw new Error('Invalid attraction identity/status');
    if (e.queue != null && (typeof e.queue !== 'object' || Array.isArray(e.queue)))
      throw new Error('Invalid queue object');
  }
  return entities;
}
