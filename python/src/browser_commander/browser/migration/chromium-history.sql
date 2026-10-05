-- Core tables match Chromium History schema 70 (compatible version 16).
-- Chromium initializes remaining ancillary tables when it opens the profile.
CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
INSERT INTO meta VALUES ('version', '70'), ('last_compatible_version', '16');
CREATE TABLE urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR,
  visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL,
  last_visit_time INTEGER DEFAULT 0 NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL
);
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL,
  visit_time INTEGER NOT NULL, from_visit INTEGER DEFAULT 0,
  external_referrer_url TEXT, transition INTEGER DEFAULT 0 NOT NULL,
  segment_id INTEGER DEFAULT 0, visit_duration INTEGER DEFAULT 0 NOT NULL,
  incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,
  opener_visit INTEGER DEFAULT 0, originator_cache_guid TEXT DEFAULT '',
  originator_visit_id INTEGER DEFAULT 0, originator_from_visit INTEGER DEFAULT 0,
  originator_opener_visit INTEGER DEFAULT 0, is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,
  consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,
  visited_link_id INTEGER DEFAULT 0 NOT NULL, app_id TEXT
);
CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
