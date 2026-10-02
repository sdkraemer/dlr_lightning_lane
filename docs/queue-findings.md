# Live feed verification — October 1, 2026 Pacific

Direct HTTPS requests to both provided live endpoints succeeded. Response entity
updates reached approximately October 2, 04:11 UTC (October 1, 21:11 Pacific).

- Disneyland: `RETURN_TIME` included AVAILABLE windows. Big Thunder Mountain
  Railroad returned 22:00–23:00 Pacific; Autopia returned 21:40–22:40.
- Disneyland: Space Mountain and others had `RETURN_TIME.state=FINISHED` with
  null window endpoints.
- DCA: `RETURN_TIME` was present on attractions such as Incredicoaster, Toy Story
  Midway Mania and WEB SLINGERS. All observed DCA return windows were FINISHED/null.
- Rise of the Resistance and Radiator Springs Racers used `PAID_RETURN_TIME`,
  including price objects; both were FINISHED/null at inspection.
- `SINGLE_RIDER` appeared on some attractions with null waits. Null is unknown,
  not zero. Some attractions had no queues at all.

Use RETURN_TIME for this Multi Pass monitor. Preserve PAID_RETURN_TIME separately;
do not use it as a fallback when Multi Pass is absent or unavailable. The feed
pattern supports the product mapping; a comparison with the user's Disney app
is still needed to establish real-world alert usefulness and modification parity.
This single sample confirms DCA exposes the field, but does not demonstrate an
available DCA window. Repeat during ordinary operating hours with an active watch.

Sources:

- https://api.themeparks.wiki/v1/entity/7340550b-c14d-4def-80bb-acdb51d49a66/live
- https://api.themeparks.wiki/v1/entity/832fcd51-ea19-4e77-85c7-75d5843b127c/live
- https://github.com/ThemeParks/ThemeParks_JavaScript (queue field documentation)

Repeated lastUpdated values can mean unchanged data, not necessarily a failed
fetch. Keep fetch timestamps and source lastUpdated separately; do not infer
queue-specific freshness from an attraction-wide update timestamp alone.
