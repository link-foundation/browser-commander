# feature-parity: safari.control@native-typed safari.setup@native-typed safari.seed@native-typed safari.unsupported@native-typed
from unittest.mock import MagicMock

import pytest

from browser_commander.browser.browser_sources import find_browser_source
from browser_commander.browser.launcher import (
    LaunchOptions,
    launch_browser_with_dependencies,
)
from browser_commander.browser.safari_webdriver import (
    SafariSetupError,
    SafariUnsupportedError,
    launch_safari,
    require_safari_feature,
)
from browser_commander.core.engine_adapter import SeleniumAdapter
from browser_commander.traces.recorder import start_trace


@pytest.mark.parametrize("channel", ["safari", "safari-tp"])
def test_safari_catalogue_exposes_webdriver(channel):
    source = find_browser_source(channel)
    assert source["controlProtocol"] == "webdriver"
    assert source["executables"]["darwin"][0].endswith("/safaridriver")


async def test_native_safari_routing_and_cookie_seeding():
    driver = MagicMock()
    driver.capabilities = {"browserName": "Safari Technology Preview"}
    driver.current_url = "about:blank"
    options = LaunchOptions(
        channel="safari-tp",
        seed_cookies=[
            {
                "domain": ".example.test",
                "name": "auth",
                "value": "yes",
                "secure": True,
                "httpOnly": True,
                "expires": 1234567890.5,
            }
        ],
    )
    create = MagicMock(return_value=driver)
    result = await launch_browser_with_dependencies(
        options, {"platform": "darwin", "create_safari": create}
    )
    assert result.browser is driver
    assert result.user_data_dir is None
    assert result.executable_path.endswith("/safaridriver")
    assert "Technology Preview.app" in result.executable_path
    driver.get.assert_any_call("https://example.test/")
    driver.get.assert_called_with("about:blank")
    added = driver.add_cookie.call_args.args[0]
    assert added["expiry"] == 1234567890
    assert added["httpOnly"] is True
    assert "expires" not in added
    assert result.close is not None
    await result.close()
    await result.close()
    driver.quit.assert_called_once()


@pytest.mark.parametrize(
    "option",
    [
        {"headless": True},
        {"user_data_dir": "/tmp/profile"},
        {"args": ["--flag"]},
        {"downloads": True},
        {"fingerprint": {}},
    ],
)
async def test_safari_rejects_unusable_options_before_start(option):
    create = MagicMock()
    with pytest.raises(SafariUnsupportedError):
        await launch_browser_with_dependencies(
            LaunchOptions(channel="safari", **option),
            {"platform": "darwin", "create_safari": create},
        )
    create.assert_not_called()


@pytest.mark.parametrize(
    "message",
    [
        "You must enable the 'Allow Remote Automation' option",
        "Run safaridriver --enable",
    ],
)
async def test_setup_diagnostics_include_steps_and_settings_offer(message):
    with pytest.raises(SafariSetupError) as caught:
        await launch_safari(
            LaunchOptions(channel="safari"),
            {
                "platform": "darwin",
                "create_safari": MagicMock(side_effect=RuntimeError(message)),
            },
        )
    assert "Show features for web developers" in str(caught.value)
    assert "admin password" in str(caught.value)
    assert callable(caught.value.open_settings)


async def test_unsupported_features_are_typed_before_work(tmp_path):
    driver = MagicMock()
    driver.capabilities = {"browserName": "safari"}
    with pytest.raises(SafariUnsupportedError, match="PDF"):
        await SeleniumAdapter(driver).pdf()
    driver.print_page.assert_not_called()
    with pytest.raises(SafariUnsupportedError, match="tracing"):
        await start_trace(page=driver, output=str(tmp_path / "trace"))
    assert not (tmp_path / "trace").exists()
    with pytest.raises(SafariUnsupportedError, match="network interception"):
        require_safari_feature(driver, "network interception")


async def test_cookie_failure_closes_session_and_restores_page():
    driver = MagicMock()
    driver.capabilities = {"browserName": "safari"}
    driver.current_url = "about:blank"
    driver.add_cookie.side_effect = RuntimeError("invalid cookie")
    with pytest.raises(RuntimeError, match="invalid cookie"):
        await launch_safari(
            LaunchOptions(
                channel="safari",
                seed_cookies=[{"domain": "example.test", "name": "a", "value": "b"}],
            ),
            {"platform": "darwin", "create_safari": lambda *_: driver},
        )
    driver.get.assert_called_with("about:blank")
    driver.quit.assert_called_once()


async def test_driver_exit_output_explains_authorization(monkeypatch):
    from selenium import webdriver

    def failed_driver(*, service, options):
        assert options.to_capabilities()["browserName"] == "Safari Technology Preview"
        service.process = None
        service.log_output.write("safaridriver requires --enable authorization\n")
        service.log_output.flush()
        raise RuntimeError("Service unexpectedly exited with status 1")

    monkeypatch.setattr(webdriver, "Safari", failed_driver)
    with pytest.raises(SafariSetupError, match="--enable authorization"):
        await launch_safari(LaunchOptions(channel="safari-tp"), {"platform": "darwin"})


async def test_empty_initial_url_is_initialized_before_seeding():
    driver = MagicMock()
    driver.capabilities = {"browserName": "safari"}
    driver.current_url = ""

    def navigate(url):
        if not url:
            raise ValueError("Could not parse requested URL ''")
        driver.current_url = url

    driver.get.side_effect = navigate
    result = await launch_safari(
        LaunchOptions(
            channel="safari",
            seed_cookies=[{"domain": "example.test", "name": "seed", "value": "yes"}],
        ),
        {"platform": "darwin", "create_safari": lambda *_: driver},
    )
    assert driver.get.call_args_list[0].args == ("about:blank",)
    assert driver.current_url == "about:blank"
    await result.close()
