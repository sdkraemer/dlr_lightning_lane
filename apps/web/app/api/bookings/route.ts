import { authorize } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { refreshParkHours } from '../../../../../packages/core/park-hours.ts';
import {
  saveBooking,
  setBookingState,
} from '../../../../../packages/core/bookings.ts';
export async function POST(request: Request) {
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 10_000)
      return Response.json({ error: 'Request too large.' }, { status: 413 });
    const body = await request.json();
    if (
      body.id !== undefined &&
      (!Number.isSafeInteger(body.id) || body.id < 1)
    )
      throw new Error('Invalid booking ID.');
    if (body.action === 'state') {
      if (body.id === undefined) throw new Error('Booking ID required.');
      setBookingState(db(), auth.userId, body.id, body.state);
      return Response.json({ ok: true });
    }
    await refreshParkHours(db());
    const id = saveBooking(db(), auth.userId, body.booking, body.id);
    return Response.json({ id });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Invalid booking.' },
      { status: 400 }
    );
  }
}
