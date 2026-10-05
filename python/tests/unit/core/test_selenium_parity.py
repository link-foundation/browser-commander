"""The common API preserves Selenium semantics and native calls (#124)."""

import base64
from unittest.mock import MagicMock

import pytest

from browser_commander.core.engine_adapter import SeleniumAdapter

# feature-parity: engines.webdriver@native-typed


async def test_text_content_includes_hidden_dom_text():
    driver = MagicMock()
    element = MagicMock()
    element.text = "visible"
    element.get_property.return_value = "visible hidden"
    assert await SeleniumAdapter(driver).get_text_content(element) == "visible hidden"
    element.get_property.assert_called_once_with("textContent")


async def test_pdf_uses_webdriver_print_and_common_options(tmp_path):
    driver = MagicMock()
    driver.print_page.return_value = base64.b64encode(b"%PDF-native").decode()
    output = tmp_path / "page.pdf"
    result = await SeleniumAdapter(driver).pdf(
        format="A4", print_background=True, margin={"top": "10mm"}, path=str(output)
    )
    assert result == b"%PDF-native"
    assert output.read_bytes() == result
    options = driver.print_page.call_args.args[0].to_dict()
    assert options["page"] == {"width": 21.0, "height": 29.7}
    assert options["background"] is True
    assert options["margin"]["top"] == 1.0


@pytest.mark.parametrize(
    "option",
    [
        "display_header_footer",
        "header_template",
        "footer_template",
        "prefer_css_page_size",
    ],
)
async def test_pdf_refuses_unsupported_options(option):
    driver = MagicMock()
    with pytest.raises(ValueError, match="WebDriver Print Page"):
        await SeleniumAdapter(driver).pdf(**{option: True})
    driver.print_page.assert_not_called()
