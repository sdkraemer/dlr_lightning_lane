-- Current schema reference, generated from versioned migrations.
-- Runtime initialization uses packages/db/migrations, not this snapshot.
PRAGMA foreign_keys=ON;

CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;

CREATE TABLE parks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'
) STRICT;

CREATE TABLE attractions (
  id TEXT PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  name TEXT NOT NULL
) STRICT;

CREATE TABLE bookings (
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
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, user_id INTEGER REFERENCES users(id),
  CHECK((target_earliest_start IS NULL AND target_latest_start IS NULL) OR
    (target_earliest_start IS NOT NULL AND target_latest_start IS NOT NULL
      AND target_latest_start >= target_earliest_start)),
  CHECK(reserved_end IS NULL OR reserved_end >= reserved_start)
) STRICT;

CREATE TABLE poll_runs (
  id INTEGER PRIMARY KEY,
  park_id TEXT NOT NULL REFERENCES parks(id),
  fetched_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('ok','error')),
  error TEXT
) STRICT;

CREATE TABLE observations (
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

CREATE TABLE queue_observations (
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  queue_type TEXT NOT NULL,
  state TEXT,
  wait_minutes INTEGER,
  return_start TEXT,
  return_end TEXT,
  raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
  PRIMARY KEY(observation_id,queue_type)
) STRICT;

CREATE TABLE alert_events (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  booking_revision INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('approaching','reached')),
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  created_at INTEGER NOT NULL,
  UNIQUE(booking_id,booking_revision,phase)
) STRICT;

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
, user_id INTEGER REFERENCES users(id)) STRICT;

CREATE TABLE push_deliveries (
  event_id INTEGER NOT NULL REFERENCES alert_events(id),
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error TEXT, canceled_at INTEGER,
  PRIMARY KEY(event_id,subscription_id)
) STRICT;

CREATE TABLE park_poll_state (
          park_id TEXT PRIMARY KEY REFERENCES parks(id),
          failures INTEGER NOT NULL DEFAULT 0,
          next_poll_at INTEGER NOT NULL DEFAULT 0
        ) STRICT;

CREATE TABLE worker_state (
          id INTEGER PRIMARY KEY CHECK(id=1),
          heartbeat_at INTEGER NOT NULL
        ) STRICT;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  auth0_sub TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX observations_history ON observations(attraction_id,observed_at);

CREATE INDEX bookings_active ON bookings(visit_date,watch_state);

CREATE INDEX bookings_user_date ON bookings(user_id,visit_date);

CREATE INDEX subscriptions_user ON push_subscriptions(user_id);
