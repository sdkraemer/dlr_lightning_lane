CREATE TABLE park_schedule_cache (
  park_id TEXT PRIMARY KEY REFERENCES parks(id),
  fetched_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  schedule_json TEXT CHECK(schedule_json IS NULL OR json_valid(schedule_json))
) STRICT;
