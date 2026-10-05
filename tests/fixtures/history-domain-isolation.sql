CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT);
INSERT INTO urls VALUES (1,'https://github.com/a'),(2,'https://notgithub.com/b');
CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER);
INSERT INTO visits VALUES(1,1),(2,2);
CREATE TABLE content_annotations(visit_id INTEGER PRIMARY KEY, search_terms TEXT);
INSERT INTO content_annotations VALUES(1,'selected'),(2,'unrelated');
CREATE TABLE context_annotations(visit_id INTEGER PRIMARY KEY);
INSERT INTO context_annotations VALUES(1),(2);
CREATE TABLE segments(id INTEGER PRIMARY KEY, url_id INTEGER);
INSERT INTO segments VALUES(1,1),(2,2);
CREATE TABLE segment_usage(segment_id INTEGER, visit_count INTEGER);
INSERT INTO segment_usage VALUES(1,1),(2,1);
CREATE TABLE downloads(id INTEGER PRIMARY KEY, site_url TEXT, tab_url TEXT);
INSERT INTO downloads VALUES(1,'https://github.com','https://github.com'),
(2,'https://notgithub.com','https://notgithub.com'),
(3,'https://github.com','https://github.com');
CREATE TABLE downloads_url_chains(id INTEGER, url TEXT);
INSERT INTO downloads_url_chains VALUES(1,'https://github.com/file'),
(2,'https://notgithub.com/file'),(3,'https://github.com/file'),
(3,'https://notgithub.com/redirect');
CREATE TABLE downloads_slices(download_id INTEGER, received_bytes INTEGER);
INSERT INTO downloads_slices VALUES(1,100),(2,100),(3,100);
