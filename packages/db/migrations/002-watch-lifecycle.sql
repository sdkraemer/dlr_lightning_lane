DROP INDEX IF EXISTS bookings_active;
        ALTER TABLE bookings DROP COLUMN expires_at;
        CREATE INDEX bookings_active ON bookings(visit_date,watch_state);
        ALTER TABLE push_deliveries ADD COLUMN canceled_at INTEGER;
        CREATE TABLE park_poll_state (
          park_id TEXT PRIMARY KEY REFERENCES parks(id),
          failures INTEGER NOT NULL DEFAULT 0,
          next_poll_at INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE worker_state (
          id INTEGER PRIMARY KEY CHECK(id=1),
          heartbeat_at INTEGER NOT NULL
        ) STRICT;
