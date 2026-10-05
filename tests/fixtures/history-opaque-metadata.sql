CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT);
INSERT INTO urls VALUES(1,'https://github.com/a'),(2,'https://notgithub.com/b');
CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER);
INSERT INTO visits VALUES(1,1),(2,2);
CREATE TABLE meta(key TEXT PRIMARY KEY, value INTEGER);
INSERT INTO meta VALUES('version',70);
CREATE TABLE clusters(cluster_id INTEGER PRIMARY KEY, label TEXT, raw_label TEXT);
INSERT INTO clusters VALUES(1,'mixed unrelated-history-marker','unrelated-history-marker'),
(2,'unrelated-history-marker','unrelated-history-marker');
CREATE TABLE clusters_and_visits(cluster_id INTEGER, visit_id INTEGER);
INSERT INTO clusters_and_visits VALUES(1,1),(1,2),(2,2);
CREATE TABLE cluster_keywords(cluster_id INTEGER, keyword TEXT);
INSERT INTO cluster_keywords VALUES(1,'selected'),(2,'unrelated-history-marker');
CREATE TABLE cluster_visit_duplicates(visit_id INTEGER, duplicate_visit_id INTEGER);
INSERT INTO cluster_visit_duplicates VALUES(1,2),(2,1);
CREATE TABLE "future ""history"" metadata"(value BLOB);
INSERT INTO "future ""history"" metadata" VALUES('unrelated-history-marker');
