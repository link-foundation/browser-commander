CREATE TABLE moz_cookies (
  name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
  isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER
);
INSERT INTO moz_cookies VALUES
  ('persistent', 'synthetic', '.expiry.example', '/', 2000000001, 1, 1, 2),
  ('session-zero', 'synthetic', '.expiry.example', '/', 0, 0, 0, 1),
  ('session-negative', 'synthetic', '.expiry.example', '/', -1, 0, 0, 0),
  ('other', 'synthetic', '.other.example', '/', 2000000001, 0, 0, 1);
