CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER, visit_type INTEGER);
INSERT INTO moz_places VALUES
  (1, 'https://github.com/first', 'First Ω'),
  (2, 'https://docs.github.com/second', NULL),
  (3, 'https://notgithub.com/other', 'Other'),
  (4, 'https://github.com/bookmark-only', 'No visits');
INSERT INTO moz_historyvisits VALUES
  (1, 1, 1700000000000001, 1),
  (2, 1, 1700000000000002, 2),
  (3, 2, 1700000000000003, 3),
  (4, 3, 1700000000000004, 1);
