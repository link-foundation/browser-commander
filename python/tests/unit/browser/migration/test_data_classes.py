"""Additional data-class reports and non-exportable platform passkeys."""

import json
from pathlib import Path

import pytest

from browser_commander.browser.migration import ALL_DATA_CLASSES, migrate_profile

CLASSES = json.loads(
    (
        Path(__file__).resolve().parents[5]
        / "tests/fixtures/migration-data-classes.json"
    ).read_text(encoding="utf-8")
)


async def test_requires_boolean_card_consent_before_target_writes(
    tmp_path: Path,
) -> None:
    target = tmp_path / "target"
    with pytest.raises(TypeError, match="must be a boolean"):
        await migrate_profile(
            from_={"browser": "chrome", "user_data_dir": tmp_path / "source"},
            to=target,
            include=["paymentCards"],
            include_payment_cards="true",  # type: ignore[arg-type]
        )
    assert not target.exists()


async def test_consented_cards_remain_explicitly_unsupported(tmp_path: Path) -> None:
    report = await migrate_profile(
        from_={"browser": "chrome", "user_data_dir": tmp_path / "source"},
        to=tmp_path / "target",
        include=["paymentCards"],
        include_payment_cards=True,
    )
    assert report["migrated"]["paymentCards"] == 0
    assert report["skipped"][0]["reason"] == "data-class-not-supported"


@pytest.mark.parametrize("browser", ["chrome", "firefox", "safari"])
async def test_reports_each_additional_class_without_reading_card_data(
    browser: str, tmp_path: Path
) -> None:
    source = tmp_path / "source"
    profile = source / "Default" if browser == "chrome" else source
    profile.mkdir(parents=True)
    marker = b"protected card store must remain unread and unchanged"
    (profile / "Web Data").write_bytes(marker)
    target = tmp_path / "new-profile"
    report = await migrate_profile(
        from_={"browser": browser, "user_data_dir": source},
        to=target,
        include=CLASSES[6:],
        platform="darwin",
    )
    assert list(ALL_DATA_CLASSES) == CLASSES
    assert list(report["migrated"]) == CLASSES
    assert all(count == 0 for count in report["migrated"].values())
    for type_ in CLASSES[6:]:
        assert any(entry["type"] == type_ for entry in report["skipped"])
    cards = next(
        entry for entry in report["skipped"] if entry["type"] == "paymentCards"
    )
    assert cards["reason"] == "payment-card-consent-required"
    passkeys = [entry for entry in report["skipped"] if entry["type"] == "passkeys"]
    assert [entry["item"] for entry in passkeys] == [
        "iCloud Keychain",
        "Google Password Manager",
        "Windows Hello",
    ]
    assert all(entry["reason"] == "passkey-not-exportable" for entry in passkeys)
    assert all("persistent profile" in entry["detail"] for entry in passkeys)
    assert not target.exists()
    assert (profile / "Web Data").read_bytes() == marker
