import pytest

from browser_commander.browser import browser_cookie_credentials as credentials
from browser_commander.browser.browser_sources import BROWSER_SOURCES


def test_credential_reader_uses_every_catalogue_identity(monkeypatch):
    for browser in BROWSER_SOURCES:
        if not browser.get("safeStorage"):
            continue
        for name in [browser["id"], *browser.get("aliases", [])]:
            calls = []

            def run(command, _environment, calls=calls):
                calls.append(command)
                return "synthetic-password"

            monkeypatch.setattr(credentials, "_run_credential_command", run)
            assert (
                credentials.read_safe_storage_password(
                    browser=name, platform="darwin", environment={}
                )
                == "synthetic-password"
            )
            assert calls == [
                [
                    "security",
                    "find-generic-password",
                    "-w",
                    "-s",
                    browser["safeStorage"]["service"],
                ]
            ]


@pytest.mark.parametrize("outcome", ["denied", "empty"])
def test_keychain_errors_identify_item_and_retry(monkeypatch, outcome):
    def run(_command, _environment):
        if outcome == "denied":
            raise PermissionError("security exited with code 36")
        return ""

    monkeypatch.setattr(credentials, "_run_credential_command", run)
    with pytest.raises(
        RuntimeError, match=r"Chrome Safe Storage.*Keychain.*allow.*retry.*refresh=true"
    ):
        credentials.read_safe_storage_password(browser="chrome", platform="darwin")
