PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'
) STRICT;
INSERT OR IGNORE INTO parks (id,name) VALUES
 ('7340550b-c14d-4def-80bb-acdb51d49a66','Disneyland Park'),
 ('832fcd51-ea19-4e77-85c7-75d5843b127c','Disney California Adventure');

CREATE TABLE IF NOT EXISTS attractions (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  name TEXT NOT NULL
) STRICT;

-- All INTEGER instants are Unix milliseconds. Visit date is the park-local date.
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  attraction_id TEXT NOT NULL REFERENCES attractions(id),
  visit_date TEXT NOT NULL,
  reserved_start INTEGER NOT NULL,
  reserved_end INTEGER,
  target_earliest_start INTEGER,
  target_latest_start INTEGER,
  queue_type TEXT NOT NULL DEFAULT 'RETURN_TIME',
  early_threshold_minutes INTEGER NOT NULL DEFAULT 15 CHECK(early_threshold_minutes >= 0),
  watch_state TEXT NOT NULL DEFAULT 'waiting'
    CHECK(watch_state IN ('waiting','watch','reached','paused','completed')),
  expires_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((target_earliest_start IS NULL AND target_latest_start IS NULL) OR
    (target_earliest_start IS NOT NULL AND target_latest_start IS NOT NULL
      AND target_latest_start >= target_earliest_start)),
  CHECK(reserved_end IS NULL OR reserved_end >= reserved_start)
) STRICT;
CREATE INDEX IF NOT EXISTS bookings_active ON bookings(watch_state,expires_at);

CREATE TABLE IF NOT EXISTS poll_runs (
  id INTEGER PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  fetched_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('ok','error')),
  error TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY,
  poll_run_id INTEGER NOT NULL REFERENCES poll_runs(id),
  attraction_id TEXT NOT NULL REFERENCES attractions(id),
  observed_at INTEGER NOT NULL,
  attraction_name TEXT NOT NULL,
  status TEXT NOT NULL,
  standby_wait INTEGER,
  api_last_updated TEXT,
  raw_entity_json TEXT NOT NULL CHECK(json_valid(raw_entity_json)),
  UNIQUE(poll_run_id,attraction_id)
) STRICT;
CREATE INDEX IF NOT EXISTS observations_history ON observations(attraction_id,observed_at);

-- One row per PRESENT queue key, including null payloads. No row means missing.
-- Preserve arbitrary future queue types without migrations or silent dropping.
CREATE TABLE IF NOT EXISTS queue_observations (
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  queue_type TEXT NOT NULL,
  state TEXT,
  wait_minutes INTEGER,
  return_start TEXT,
  return_end TEXT,
  raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
  PRIMARY KEY(observation_id,queue_type)
) STRICT;

-- Future push delivery: one logical event per booking revision and phase.
CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  booking_revision INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('approaching','reached')),
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  created_at INTEGER NOT NULL,
  UNIQUE(booking_id,booking_revision,phase)
) STRICT;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
) STRICT;
CREATE TABLE IF NOT EXISTS push_deliveries (
  event_id INTEGER NOT NULL REFERENCES alert_events(id),
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT,
  PRIMARY KEY(event_id,subscription_id)
) STRICT;
