import type { DatabaseSync } from 'node:sqlite';
import { hasPendingWatch } from '../db/index.ts';
import { parkDate } from './time.ts';
import { latestOffer,phaseFor,MAX_OBSERVATION_AGE } from './alerts.ts';
export function dashboard(db:DatabaseSync,now=Date.now()) {
  const date=parkDate(now);
  const bookings=db.prepare(`SELECT b.*,a.name,p.name park_name FROM bookings b JOIN attractions a ON a.id=b.attraction_id
    JOIN parks p ON p.id=a.park_id WHERE b.visit_date=? ORDER BY b.reserved_start`).all(date).map(b=>{
      const offer=latestOffer(db,String(b.attraction_id),String(b.queue_type));
      let displayState='Waiting';
      if (b.watch_state==='completed') displayState='Completed';
      else if (b.watch_state==='paused') displayState='Paused';
      else if (b.target_earliest_start===null) displayState='No target';
      else if (Number(b.reserved_start)>=Number(b.target_earliest_start)&&Number(b.reserved_start)<=Number(b.target_latest_start)) displayState='Booking in target';
      else if (!offer||now-offer.observed_at>MAX_OBSERVATION_AGE) displayState='Awaiting fresh data';
      else {
        const phase=phaseFor(offer,Number(b.target_earliest_start),Number(b.target_latest_start),Number(b.early_threshold_minutes),now);
        displayState=phase==='reached'?'Target reached':phase==='approaching'?'Watch':'Waiting';
      }
      return {...b,offer:offer??null,displayState};
    });
  return {date,now,bookings,monitoringEnabled:process.env.MONITORING_ENABLED!=='false',pollingNeeded:hasPendingWatch(db,now),
    heartbeat:db.prepare('SELECT heartbeat_at FROM worker_state WHERE id=1').get()?.heartbeat_at??null,
    parks:db.prepare(`SELECT p.*,r.fetched_at,r.outcome,r.error FROM parks p LEFT JOIN poll_runs r ON r.id=(
      SELECT id FROM poll_runs WHERE park_id=p.id ORDER BY fetched_at DESC,id DESC LIMIT 1)`).all(),
    attractions:db.prepare('SELECT a.*,p.name park_name FROM attractions a JOIN parks p ON p.id=a.park_id ORDER BY a.name').all(),
    deliveries:db.prepare(`SELECT d.sent_at,d.last_error,d.canceled_at,e.phase,a.name FROM push_deliveries d
      JOIN alert_events e ON e.id=d.event_id JOIN bookings b ON b.id=e.booking_id
      JOIN attractions a ON a.id=b.attraction_id ORDER BY e.created_at DESC LIMIT 5`).all(),
  };
}
