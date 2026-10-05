"""Firefox history translation preserves individual visits and source bytes."""

import sqlite3
from pathlib import Path

import pytest

from browser_commander.browser.migration import migrate_profile

SCHEMA = (
    Path(__file__).resolve().parents[5] / "tests/fixtures/firefox-history.sql"
).read_text()


@pytest.mark.parametrize("domains", [[], ["GITHUB.COM."]])
async def test_translates_visits_and_filters_domains(
    tmp_path: Path, domains: list[str]
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    filename = source / "places.sqlite"
    with sqlite3.connect(filename) as db:
        db.executescript(SCHEMA)
    db.close()
    before = filename.read_bytes()
    target = tmp_path / "new-profile"
    report = await migrate_profile(
        from_={"browser": "firefox", "user_data_dir": source},
        to=target,
        include=["history"],
        domains=domains,
    )
    count = 3 if domains else 4
    assert report["migrated"]["history"] == count
    assert report["skipped"] == []
    assert report["warnings"][0]["reason"] == "firefox-history-metadata-not-translated"
    with sqlite3.connect(target / "History") as db:
        rows = db.execute(
            "SELECT url,title,visit_count,last_visit_time FROM urls ORDER BY url"
        ).fetchall()
        assert rows[:2] == [
            ("https://docs.github.com/second", "", 1, 13344473600000003),
            ("https://github.com/first", "First Ω", 2, 13344473600000002),
        ]
        assert [
            row[0]
            for row in db.execute("SELECT visit_time FROM visits ORDER BY visit_time")
        ] == [
            13344473600000001,
            13344473600000002,
            13344473600000003,
            13344473600000004,
        ][:count]
    db.close()
    assert filename.read_bytes() == before
    assert not (target / "places.sqlite").exists()


@pytest.mark.parametrize("value", ["NULL", "''", "x'0102'"])
async def test_reports_invalid_visit_urls(tmp_path: Path, value: str) -> None:
    source = tmp_path / "source"
    source.mkdir()
    filename = source / "places.sqlite"
    with sqlite3.connect(filename) as db:
        db.executescript(SCHEMA)
        db.execute(f"INSERT INTO moz_places VALUES (5,{value},'Invalid')")
        db.execute("INSERT INTO moz_historyvisits VALUES (5,5,1700000000000005,1)")
    db.close()
    before = filename.read_bytes()
    report = await migrate_profile(
        from_={"browser": "firefox", "user_data_dir": source},
        to=tmp_path / "new-profile",
        include=["history"],
        domains=["github.com"],
    )
    assert report["migrated"]["history"] == 3
    assert len(report["skipped"]) == 1
    assert report["skipped"][0]["reason"] == "invalid-history-url"
    assert report["skipped"][0]["item"] == "places.sqlite visit 5"
    assert filename.read_bytes() == before


async def test_reports_missing_visit_table_before_creating_target(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    with sqlite3.connect(source / "places.sqlite") as db:
        db.execute(
            "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT)"
        )
    db.close()
    target = tmp_path / "new-profile"
    report = await migrate_profile(
        from_={"browser": "firefox", "user_data_dir": source},
        to=target,
        include=["history"],
    )
    assert report["migrated"]["history"] == 0
    assert report["skipped"][0]["reason"] == "source-format-unsupported"
    assert "moz_historyvisits" in report["skipped"][0]["detail"]
    assert not target.exists()


@pytest.mark.parametrize(
    "value", ["NULL", "'invalid'", "1.5", "-11644473600000001", "9223372036854775807"]
)
async def test_reports_corrupt_or_overflowing_dates(tmp_path: Path, value: str) -> None:
    source = tmp_path / "source"
    source.mkdir()
    filename = source / "places.sqlite"
    with sqlite3.connect(filename) as db:
        db.executescript(SCHEMA)
        db.execute(f"INSERT INTO moz_historyvisits VALUES (5,1,{value},1)")
    db.close()
    before = filename.read_bytes()
    report = await migrate_profile(
        from_={"browser": "firefox", "user_data_dir": source},
        to=tmp_path / "new-profile",
        include=["history"],
        domains=["github.com"],
    )
    assert report["migrated"]["history"] == 3
    assert len(report["skipped"]) == 1
    assert report["skipped"][0]["reason"] == "invalid-history-timestamp"
    assert report["skipped"][0]["item"] == "places.sqlite visit 5"
    assert filename.read_bytes() == before
