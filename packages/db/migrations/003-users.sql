CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  auth0_sub TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

-- NULL ownership quarantines legacy data until an explicit owner is configured.
ALTER TABLE bookings ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE push_subscriptions ADD COLUMN user_id INTEGER REFERENCES users(id);
CREATE INDEX bookings_user_date ON bookings(user_id,visit_date);
CREATE INDEX subscriptions_user ON push_subscriptions(user_id);
