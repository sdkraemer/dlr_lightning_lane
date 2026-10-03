'use client';
import { useCallback, useEffect, useState } from 'react';

type Attraction = {
  id: string;
  name: string;
  park_name: string;
  park_id: string;
};
type TimeSlot = { value: string; instant: number; nextDay: boolean };
type ParkHours = {
  parkId: string;
  status: string;
  stale: boolean;
  windows: { opensAt: number; closesAt: number }[];
  slots: TimeSlot[];
};
type Offer = {
  observed_at: number;
  status: string;
  state: string | null;
  return_start: string | null;
  return_end: string | null;
  standby_wait: number | null;
};
type Booking = {
  id: number;
  attraction_id: string;
  name: string;
  park_name: string;
  reserved_start: number;
  reserved_end: number | null;
  target_earliest_start: number | null;
  target_latest_start: number | null;
  early_threshold_minutes: number;
  watch_state: string;
  displayState: string;
  offer: Offer | null;
  farthestOffer: { return_start: string; return_end: string; observed_at: number } | null;
};
type Data = {
  date: string;
  now: number;
  bookings: Booking[];
  attractions: Attraction[];
  parkHours: ParkHours[];
  heartbeat: number | null;
  monitoringEnabled: boolean;
  pollingNeeded: boolean;
  parks: { name: string; fetched_at: number | null; outcome: string | null }[];
  deliveries: {
    name: string;
    phase: string;
    sent_at: number | null;
    last_error: string | null;
    canceled_at: number | null;
  }[];
};
type Form = {
  attractionId: string;
  reservedStart: string;
  targetEarliest: string;
  targetLatest: string;
  earlyMinutes: number;
};
const empty: Form = {
  attractionId: '',
  reservedStart: '',
  targetEarliest: '',
  targetLatest: '',
  earlyMinutes: 15,
};
const time = (value: number | string | null | undefined) =>
  value == null
    ? '—'
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value));
const clock = (value: number | null) =>
  value === null
    ? ''
    : new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(value);
const age = (value: number | null, now: number) =>
  value === null
    ? 'Not yet'
    : Math.max(0, Math.floor((now - value) / 60_000)) + 'm ago';
async function api(url: string, body?: unknown) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function TimePicker({
  label,
  value,
  onChange,
  slots,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  slots: TimeSlot[];
  required?: boolean;
}) {
  const [hour = '', minute = ''] = value.split(':');
  const hours = [...new Set(slots.map((slot) => slot.value.slice(0, 2)))];
  const minutes = slots
    .filter((slot) => slot.value.startsWith(hour + ':'))
    .map((slot) => slot.value.slice(3));
  return (
    <div className="fields">
      <label>
        {label} hour
        <select
          aria-label={label + ' hour'}
          required={required}
          disabled={!slots.length}
          value={hours.includes(hour) ? hour : ''}
          onChange={(e) => {
            const choices = slots.filter((slot) =>
              slot.value.startsWith(e.target.value + ':')
            );
            onChange(
              e.target.value
                ? (
                    choices.find((slot) => slot.value.slice(3) === minute) ??
                    choices[0]
                  ).value
                : ''
            );
          }}
        >
          <option value="" disabled={required}>
            {required ? 'Hour' : 'Not set'}
          </option>
          {hours.map((hour) => (
            <option key={hour} value={hour}>
              {Number(hour) % 12 || 12} {Number(hour) < 12 ? 'AM' : 'PM'}
              {slots.find((slot) => slot.value.startsWith(hour + ':'))?.nextDay
                ? ' (next day)'
                : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        {label} minute
        <select
          aria-label={label + ' minute'}
          required={!!value}
          disabled={!minutes.length}
          value={minutes.includes(minute) ? minute : ''}
          onChange={(e) => onChange(hour + ':' + e.target.value)}
        >
          <option value="" disabled>
            Minute
          </option>
          {minutes.map((minute) => (
            <option key={minute} value={minute}>
              {minute}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export default function Dashboard({ mock }: { mock: boolean }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<number | null | undefined>(undefined),
    [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false),
    [pushEnabled, setPushEnabled] = useState(false),
    [pushConfigured, setPushConfigured] = useState(false);
  const [pushConfigError, setPushConfigError] = useState('');
  const [online, setOnline] = useState(true),
    [now, setNow] = useState(Date.now());
  const refresh = useCallback(async () => {
    try {
      setData(await api('/api/dashboard'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 15_000);
    const connected = () => setOnline(navigator.onLine);
    connected();
    window.addEventListener('online', connected);
    window.addEventListener('offline', connected);
    if ('serviceWorker' in navigator)
      navigator.serviceWorker
        .register('/sw.js')
        .then(async (reg) => {
          const sub = await reg.pushManager.getSubscription();
          setPushEnabled(
            sub
              ? (
                  await api('/api/push', {
                    action: 'status',
                    subscription: sub.toJSON(),
                  })
                ).enabled
              : false
          );
        })
        .catch(() => {});
    api('/api/push')
      .then((config) => {
        setPushConfigured(config.configured);
        setPushConfigError(config.error ?? '');
      })
      .catch(() => {});
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', connected);
    };
  }, [refresh]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/bookings', { id: editing ?? undefined, booking: form });
      setEditing(undefined);
      setNotice(
        'Booking saved. Update it here after changing it in Disneyland.'
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(b?: Booking) {
    setEditing(b?.id ?? null);
    setError('');
    setForm(
      b
        ? {
            attractionId: b.attraction_id,
            reservedStart: clock(b.reserved_start),
            targetEarliest: clock(b.target_earliest_start),
            targetLatest: clock(b.target_latest_start),
            earlyMinutes: b.early_threshold_minutes,
          }
        : { ...empty, attractionId: data?.attractions[0]?.id ?? '' }
    );
  }
  async function state(b: Booking, value: string) {
    setBusy(true);
    try {
      await api('/api/bookings', { id: b.id, action: 'state', state: value });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function notifications(action: 'enable' | 'disable' | 'test') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window))
        throw new Error(
          'Push notifications are not supported in this browser.'
        );
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (action === 'enable') {
        if ((await Notification.requestPermission()) !== 'granted')
          throw new Error(
            'Allow notifications in your browser settings, then try again.'
          );
        const config = await api('/api/push');
        if (!config.configured)
          throw new Error(
            config.error ??
              'Notifications are not configured on the server yet.'
          );
        const raw = atob(
          config.publicKey.replace(/-/g, '+').replace(/_/g, '/')
        );
        // A browser subscription may belong to a different signed-in account.
        // Rotate it explicitly instead of transferring that account's device record.
        if (
          sub &&
          !(
            await api('/api/push', {
              action: 'status',
              subscription: sub.toJSON(),
            })
          ).enabled
        ) {
          if (!(await sub.unsubscribe()))
            throw new Error(
              'Could not reset this device’s notifications. Try again.'
            );
          sub = null;
        }
        sub ??= await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(raw, (c: string) =>
            c.charCodeAt(0)
          ),
        });
      }
      if (!sub) throw new Error('Enable notifications first.');
      await api('/api/push', { action, subscription: sub.toJSON() });
      if (action === 'disable') await sub.unsubscribe();
      setPushEnabled(action !== 'disable');
      setNotice(
        action === 'test'
          ? 'Test accepted by the push service. Check your device.'
          : action === 'enable'
            ? 'Notifications enabled on this device.'
            : 'Notifications disabled on this device.'
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selectedAttraction = data?.attractions.find(
    (attraction) => attraction.id === form.attractionId
  );
  const selectedHours = data?.parkHours.find(
    (hours) => hours.parkId === selectedAttraction?.park_id
  );
  const timeSlots = selectedHours?.slots ?? [];
  const invalidTimes = [
    form.reservedStart,
    form.targetEarliest,
    form.targetLatest,
  ].some((value) => value && !timeSlots.some((slot) => slot.value === value));
  const active =
    data?.bookings.filter((b) => b.watch_state !== 'completed') ?? [];
  return (
    <main className="shell">
      <header className="masthead">
        <a href="/" className="brand">
          <span className="bolt" aria-hidden="true">
            ϟ
          </span>{' '}
          RETURN WINDOW
        </a>
        <div className="account">
          {mock ? (
            <span className="dev">Local preview</span>
          ) : (
            <a href="/auth/logout">Sign out</a>
          )}
        </div>
      </header>
      <section className="intro">
        <div>
          <span className="eyebrow">
            Disneyland Resort · {data?.date ?? 'Today'}
          </span>
          <h1>My Lightning Lanes</h1>
        </div>
        <button
          className="primary"
          onClick={() => edit()}
          disabled={!data?.attractions.length}
        >
          ＋ Add booking
        </button>
      </section>
      <div className="status-strip">
        <span
          className={'signal ' + (data?.pollingNeeded && online ? 'on' : '')}
        />
        <strong>
          {!online
            ? 'Offline'
            : !data
              ? 'Loading'
              : !data.monitoringEnabled
                ? 'Monitoring disabled'
                : data.pollingNeeded
                  ? 'Monitoring'
                  : 'No pending watches'}
        </strong>
        <span className="status-note">All times Pacific · Alerts only</span>
      </div>
      {data?.pollingNeeded &&
        (!data.heartbeat || now - data.heartbeat > 300_000) && (
          <p className="banner warning">
            The background worker has not checked in recently. Return times may
            be out of date.
          </p>
        )}
      {!online && (
        <p className="banner warning">
          Reconnect to see current offers. The server can continue watching your
          bookings.
        </p>
      )}
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="banner">
          {notice}
        </p>
      )}
      {editing !== undefined && (
        <section className="editor" aria-labelledby="editor-title">
          <div className="section-heading">
            <h2 id="editor-title">
              {editing === null ? 'Add today’s booking' : 'Update your booking'}
            </h2>
            <button
              className="text-button"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </button>
          </div>
          <form onSubmit={save}>
            <label className="full">
              Attraction
              <select
                aria-label="Attraction"
                required
                value={form.attractionId}
                onChange={(e) =>
                  setForm((previous) => {
                    const attraction = data?.attractions.find(
                      (a) => a.id === e.target.value
                    );
                    const slots =
                      data?.parkHours.find(
                        (h) => h.parkId === attraction?.park_id
                      )?.slots ?? [];
                    const keep = (value: string) =>
                      slots.some((slot) => slot.value === value) ? value : '';
                    return {
                      ...previous,
                      attractionId: e.target.value,
                      reservedStart: keep(previous.reservedStart),
                      targetEarliest: keep(previous.targetEarliest),
                      targetLatest: keep(previous.targetLatest),
                    };
                  })
                }
              >
                {data?.attractions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ·{' '}
                    {a.park_name === 'Disneyland Park' ? 'Disneyland' : 'DCA'}
                  </option>
                ))}
              </select>
            </label>
            <p className="form-note" role="status">
              {timeSlots.length
                ? (selectedHours?.stale
                    ? 'Last known park hours: '
                    : 'Park hours: ') +
                  selectedHours!.windows
                    .map(
                      (window) =>
                        time(window.opensAt) + ' – ' + time(window.closesAt)
                    )
                    .join(', ') +
                  ' Pacific'
                : 'Park hours are unavailable for today. Time selection will be available when hours load.'}
            </p>
            {invalidTimes && (
              <p className="form-note" role="alert">
                Choose times within the selected park’s hours.
              </p>
            )}
            <fieldset>
              <legend>Currently reserved</legend>
              <TimePicker
                slots={timeSlots}
                label="Start"
                value={form.reservedStart}
                required
                onChange={(reservedStart) =>
                  setForm({ ...form, reservedStart })
                }
              />
              <p className="form-note">Ends one hour after the start.</p>
            </fieldset>
            <fieldset>
              <legend>
                Desired start range <span>(optional)</span>
              </legend>
              <div className="range-pickers">
                <TimePicker
                  slots={timeSlots}
                  label="Earliest"
                  value={form.targetEarliest}
                  onChange={(targetEarliest) =>
                    setForm({ ...form, targetEarliest })
                  }
                />
                <TimePicker
                  slots={timeSlots}
                  label="Latest"
                  value={form.targetLatest}
                  onChange={(targetLatest) =>
                    setForm({ ...form, targetLatest })
                  }
                />
              </div>
            </fieldset>
            <label>
              Early warning · minutes
              <input
                type="number"
                min="0"
                max="120"
                value={form.earlyMinutes}
                onChange={(e) =>
                  setForm({ ...form, earlyMinutes: Number(e.target.value) })
                }
              />
            </label>
            <p className="form-note">
              Today only. Alerts stop once your reserved start is inside your
              desired range.
            </p>
            <button
              className="primary"
              disabled={busy || !timeSlots.length || invalidTimes}
            >
              Save booking
            </button>
          </form>
        </section>
      )}
      <div className="content-grid">
        <section aria-label="Watched bookings">
          <div className="section-heading">
            <h2>
              Today’s plans <span className="count">{active.length}</span>
            </h2>
          </div>
          {!data ? (
            <div className="empty">Loading your plans…</div>
          ) : !active.length ? (
            <div className="empty">
              <h3>No bookings yet</h3>
              <p>Add a booking to watch for your preferred return time.</p>
              {!data.attractions.length && (
                <p>
                  Lightning Lane Multi Pass attraction data is not available
                  yet.
                </p>
              )}
              <button
                onClick={() => edit()}
                disabled={!data.attractions.length}
              >
                Add your first booking
              </button>
            </div>
          ) : (
            active.map((b) => {
              const stale = !b.offer || now - b.offer.observed_at > 300_000;
              const available =
                b.offer?.state === 'AVAILABLE' &&
                b.offer.return_start &&
                b.offer.return_end;
              return (
                <article className="booking" key={b.id}>
                  <div className="card-top">
                    <span className="eyebrow">
                      {b.park_name === 'Disneyland Park'
                        ? 'Disneyland Park'
                        : 'Disney California Adventure'}
                    </span>
                    <span
                      className={
                        'badge ' +
                        (b.displayState === 'Target reached' ||
                        b.displayState === 'Booking in target'
                          ? 'success'
                          : b.displayState === 'Watch'
                            ? 'watch'
                            : '')
                      }
                    >
                      {b.displayState}
                    </span>
                  </div>
                  <h3>{b.name}</h3>
                  <div className="window-grid">
                    <div>
                      <span className="label">Your booking</span>
                      <strong>{time(b.reserved_start)}</strong>
                      <small>until {time(b.reserved_end)}</small>
                    </div>
                    <div className="offered">
                      <span className="label">
                        {stale ? 'Last offered' : 'Currently offered'}
                      </span>
                      <strong>
                        {available ? time(b.offer!.return_start) : '—'}
                      </strong>
                      <small>
                        {available
                          ? 'until ' + time(b.offer!.return_end)
                          : b.offer?.state === 'FINISHED'
                            ? 'No return window available'
                            : 'Return time unavailable'}
                      </small>
                    </div>
                    <div className="latest-observed">
                      <span className="label">Latest observed</span>
                      <strong>{b.farthestOffer ? time(b.farthestOffer.return_start) : '—'}</strong>
                      <small>{b.farthestOffer
                        ? 'Today · seen at ' + time(b.farthestOffer.observed_at)
                        : 'No available return window recorded today'}</small>
                      {available && !stale && b.farthestOffer &&
                        Date.parse(b.offer!.return_start!) < Date.parse(b.farthestOffer.return_start) &&
                        <small className="earlier-offer">Current offer is {Math.round((Date.parse(b.farthestOffer.return_start) - Date.parse(b.offer!.return_start!)) / 60000)} min earlier.</small>}
                    </div>
                    <div className="standby">
                      <span className="label">
                        {stale ? 'Last standby' : 'Standby wait'}
                      </span>
                      <strong>
                        {b.offer?.standby_wait == null
                          ? '—'
                          : b.offer.standby_wait + ' min'}
                      </strong>
                    </div>
                  </div>
                  <div className="target">
                    <span className="label">Desired start</span>
                    <strong>
                      {b.target_earliest_start !== null
                        ? time(b.target_earliest_start) +
                          ' – ' +
                          time(b.target_latest_start)
                        : 'Not set'}
                    </strong>
                  </div>
                  <div className="card-meta">
                    <span>
                      {b.offer?.status?.replaceAll('_', ' ') ??
                        'No observations'}{' '}
                      · {age(b.offer?.observed_at ?? null, now)}
                      {stale ? ' · stale' : ''}
                    </span>
                  </div>
                  <div className="card-actions">
                    <button onClick={() => edit(b)} disabled={busy}>
                      Update booking
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        state(
                          b,
                          b.watch_state === 'paused' ? 'waiting' : 'paused'
                        )
                      }
                      disabled={busy}
                    >
                      {b.watch_state === 'paused' ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => state(b, 'completed')}
                      disabled={busy}
                    >
                      Done
                    </button>
                  </div>
                </article>
              );
            })
          )}
          {!!data?.bookings.some((b) => b.watch_state === 'completed') && (
            <details className="completed">
              <summary>Completed today</summary>
              {data.bookings
                .filter((b) => b.watch_state === 'completed')
                .map((b) => (
                  <div key={b.id}>
                    {b.name}
                    <button onClick={() => state(b, 'waiting')}>Restore</button>
                  </div>
                ))}
            </details>
          )}
        </section>
        <aside>
          <section className="side-card">
            <h2>Notifications</h2>
            <p>
              {pushEnabled
                ? 'Enabled on this device.'
                : 'Get alerts for your desired return time.'}
            </p>
            <button
              disabled={busy || (!pushConfigured && !pushEnabled)}
              onClick={() => notifications(pushEnabled ? 'disable' : 'enable')}
            >
              {pushEnabled ? 'Disable this device' : 'Enable notifications'}
            </button>
            {pushEnabled && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => notifications('test')}
              >
                Send a test
              </button>
            )}
            {!pushConfigured && (
              <small role="status">
                {pushConfigError || 'Push setup pending.'}
              </small>
            )}
            {pushEnabled && (
              <small>Notifications stay on after sign-out.</small>
            )}
          </section>
          <section className="feed">
            <h2>Park feeds</h2>
            {data?.parks.map((p) => (
              <div key={p.name}>
                <strong>{p.name}</strong>
                <span>
                  {p.outcome === 'error'
                    ? 'Latest fetch failed'
                    : p.fetched_at
                      ? 'Fetched ' + age(p.fetched_at, now)
                      : 'No data yet'}
                </span>
              </div>
            ))}
            <p>
              Offers can change between checks. Confirm availability in the
              Disneyland app before modifying.
            </p>
          </section>
          {!!data?.deliveries.length && (
            <section className="feed">
              <h2>Recent alerts</h2>
              {data.deliveries.map((d, i) => (
                <div key={i}>
                  <strong>{d.name}</strong>
                  <span>
                    {d.sent_at
                      ? 'Sent to push service'
                      : d.canceled_at
                        ? 'No longer applicable'
                        : d.last_error
                          ? 'Retry pending'
                          : 'Queued'}{' '}
                    · {d.phase}
                  </span>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
      <footer>
        <span>
          Confirm availability and change bookings in the Disneyland app.
        </span>
        <span>Not affiliated with Disney.</span>
      </footer>
    </main>
  );
}
