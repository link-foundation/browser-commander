-- A compatible Login Data store with stable credential identity and associations.
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
INSERT INTO meta VALUES ('version','34'), ('last_compatible_version','1');
CREATE TABLE logins(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_url TEXT NOT NULL, username_element TEXT, username_value TEXT,
  password_element TEXT, signon_realm TEXT NOT NULL, password_value BLOB,
  date_created INTEGER, date_last_used INTEGER,
  UNIQUE(origin_url, username_element, username_value, password_element, signon_realm)
);
CREATE TABLE password_notes(id INTEGER PRIMARY KEY, parent_id INTEGER, key TEXT, value BLOB, date_created INTEGER, confidential INTEGER);
CREATE TABLE insecure_credentials(parent_id INTEGER, insecurity_type INTEGER);
CREATE TABLE sync_model_metadata(id INTEGER PRIMARY KEY, model_metadata BLOB);
