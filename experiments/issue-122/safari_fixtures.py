"""Generate shared Safari fixtures without reading a user's browser data."""

import csv
import plistlib
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "tests/fixtures/safari-data"
ROOT.mkdir(parents=True, exist_ok=True)
TREE = {
    "WebBookmarkType": "WebBookmarkTypeList",
    "Children": [
        {
            "WebBookmarkType": "WebBookmarkTypeList",
            "Title": "Work",
            "Children": [
                {
                    "WebBookmarkType": "WebBookmarkTypeLeaf",
                    "URLString": "https://github.com/link-foundation",
                    "URIDictionary": {"title": "Foundation ☃"},
                }
            ],
        },
        {
            "WebBookmarkType": "WebBookmarkTypeList",
            "Title": "com.apple.ReadingList",
            "Children": [
                {
                    "WebBookmarkType": "WebBookmarkTypeLeaf",
                    "URLString": "https://example.org/read",
                    "URIDictionary": {"title": "Read later"},
                    "ReadingList": {"PreviewText": "An article"},
                }
            ],
        },
    ],
}
for name, format_ in (("binary", plistlib.FMT_BINARY), ("xml", plistlib.FMT_XML)):
    (ROOT / f"Bookmarks-{name}.plist").write_bytes(plistlib.dumps(TREE, fmt=format_))
history = ROOT / "History.db"
history.unlink(missing_ok=True)
with sqlite3.connect(history) as db:
    db.executescript(
        "CREATE TABLE history_items(id INTEGER PRIMARY KEY, url TEXT);"
        "CREATE TABLE history_visits(id INTEGER PRIMARY KEY, history_item INTEGER, "
        "visit_time REAL, title TEXT);"
        "INSERT INTO history_items VALUES(1,'https://github.com/one'),"
        "(2,'https://notgithub.com/two');"
        "INSERT INTO history_visits VALUES(1,1,800000000.25,'One'),"
        "(2,1,800000001.75,'Again'),(3,2,800000002,'Excluded');"
    )
with (ROOT / "Passwords.csv").open("w", encoding="utf-8-sig", newline="") as output:
    writer = csv.writer(output)
    writer.writerow(["Title", "URL", "Username", "Password", "Notes", "OTPAuth"])
    writer.writerow(["Snow ☃", "https://github.com/login", "a,b", 'p"a\nss', "", ""])
    writer.writerow(["Unrelated", "https://notgithub.com", "other", "exclude", "", ""])
