//! Common browser operations backed by the typed W3C client.

use super::ManagedWebDriver;
use crate::core::engine::{ElementInfo, EngineAdapter, EngineError, EngineType, PdfOptions};
use async_trait::async_trait;
use fantoccini::{
    actions::{InputSource, KeyAction, KeyActions, MouseActions, PointerAction},
    Locator,
};
use serde_json::{json, Value};
use std::time::Duration;

fn error(error: impl std::fmt::Display) -> EngineError {
    EngineError::Browser(error.to_string())
}
fn key(value: &str) -> Result<char, EngineError> {
    use fantoccini::key::Key;
    Ok(match value {
        "Enter" => Key::Enter.into(),
        "Tab" => Key::Tab.into(),
        "Escape" | "Esc" => Key::Escape.into(),
        "Shift" => Key::Shift.into(),
        "Control" | "Ctrl" => Key::Control.into(),
        "Alt" => Key::Alt.into(),
        "Meta" => Key::Meta.into(),
        "Backspace" => Key::Backspace.into(),
        "Delete" => Key::Delete.into(),
        "Space" => Key::Space.into(),
        "ArrowUp" => Key::Up.into(),
        "ArrowDown" => Key::Down.into(),
        "ArrowLeft" => Key::Left.into(),
        "ArrowRight" => Key::Right.into(),
        "Home" => Key::Home.into(),
        "End" => Key::End.into(),
        "PageUp" => Key::PageUp.into(),
        "PageDown" => Key::PageDown.into(),
        value if value.chars().count() == 1 => value.chars().next().unwrap(),
        _ => return Err(error(format!("Unknown WebDriver key: {value}"))),
    })
}

impl ManagedWebDriver {
    async fn elements(&self, selector: &str) -> Result<Vec<ElementInfo>, EngineError> {
        let result=self.client.execute(r#"return [...document.querySelectorAll(arguments[0])].map(e=>{
            const r=e.getBoundingClientRect(); const style=getComputedStyle(e);
            return {tag:e.tagName,text:e.textContent,visible:!!(r.width&&r.height)&&style.visibility!=='hidden'&&style.display!=='none',
                enabled:!e.disabled,box:[r.x,r.y,r.width,r.height]};
        })"#,vec![json!(selector)]).await.map_err(error)?;
        let values = result
            .as_array()
            .ok_or_else(|| error("Invalid WebDriver element response"))?;
        values
            .iter()
            .map(|value| {
                Ok(ElementInfo {
                    tag_name: value["tag"].as_str().unwrap_or("").into(),
                    text_content: value["text"].as_str().map(str::to_owned),
                    is_visible: value["visible"].as_bool().unwrap_or(false),
                    is_enabled: value["enabled"].as_bool().unwrap_or(false),
                    bounding_box: Some(
                        serde_json::from_value(value["box"].clone()).map_err(error)?,
                    ),
                })
            })
            .collect()
    }
    async fn keys(&self, actions: Vec<KeyAction>) -> Result<(), EngineError> {
        let sequence = actions
            .into_iter()
            .fold(KeyActions::new("bc-keyboard".into()), |sequence, action| {
                sequence.then(action)
            });
        self.client.perform_actions(sequence).await.map_err(error)
    }
}

#[async_trait]
impl EngineAdapter for ManagedWebDriver {
    fn require_feature(&self, feature: &str) -> Result<(), EngineError> {
        ManagedWebDriver::require_feature(self, feature)
    }
    fn engine_type(&self) -> EngineType {
        EngineType::Fantoccini
    }
    async fn url(&self) -> Result<String, EngineError> {
        Ok(self.client.current_url().await.map_err(error)?.into())
    }
    async fn goto(&self, url: &str) -> Result<(), EngineError> {
        self.client.goto(url).await.map_err(error)
    }
    async fn goto_with_options(
        &self,
        url: &str,
        wait_until: &str,
        timeout_ms: u64,
    ) -> Result<(), EngineError> {
        if wait_until == "networkidle" {
            return Err(EngineError::Unsupported {
                browser: "fantoccini".into(),
                feature: "network-idle navigation milestone".into(),
            });
        }
        let operation = async {
            if let Some(bidi) = &self.bidi {
                let context = String::from(self.client.window().await.map_err(error)?);
                bidi.send("browsingContext.navigate", json!({"context":context,"url":url,"wait": if wait_until == "domcontentloaded" { "interactive" } else { "complete" }})).await.map_err(error)?;
                Ok(())
            } else if wait_until == "load" {
                self.goto(url).await
            } else {
                Err(EngineError::Unsupported {
                    browser: "fantoccini".into(),
                    feature: "DOMContentLoaded navigation requires WebDriver BiDi".into(),
                })
            }
        };
        tokio::time::timeout(Duration::from_millis(timeout_ms), operation)
            .await
            .map_err(|_| EngineError::Timeout("navigation milestone".into()))?
    }
    async fn query_selector(&self, selector: &str) -> Result<Option<ElementInfo>, EngineError> {
        Ok(self.elements(selector).await?.into_iter().next())
    }
    async fn query_selector_all(&self, selector: &str) -> Result<Vec<ElementInfo>, EngineError> {
        self.elements(selector).await
    }
    async fn count(&self, selector: &str) -> Result<usize, EngineError> {
        Ok(self
            .client
            .find_all(Locator::Css(selector))
            .await
            .map_err(error)?
            .len())
    }
    async fn click(&self, selector: &str) -> Result<(), EngineError> {
        self.client
            .find(Locator::Css(selector))
            .await
            .map_err(error)?
            .click()
            .await
            .map_err(error)
    }
    async fn mouse_click(&self, x: f64, y: f64) -> Result<(), EngineError> {
        self.client
            .perform_actions(
                MouseActions::new("bc-pointer".into())
                    .then(PointerAction::MoveTo {
                        duration: None,
                        x,
                        y,
                    })
                    .then(PointerAction::Down { button: 0 })
                    .then(PointerAction::Up { button: 0 }),
            )
            .await
            .map_err(error)
    }
    async fn fill(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        let element = self
            .client
            .find(Locator::Css(selector))
            .await
            .map_err(error)?;
        element.clear().await.map_err(error)?;
        element.send_keys(text).await.map_err(error)
    }
    async fn type_text(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        self.client
            .find(Locator::Css(selector))
            .await
            .map_err(error)?
            .send_keys(text)
            .await
            .map_err(error)
    }
    async fn text_content(&self, selector: &str) -> Result<Option<String>, EngineError> {
        Ok(self
            .client
            .execute(
                "return document.querySelector(arguments[0])?.textContent ?? null",
                vec![json!(selector)],
            )
            .await
            .map_err(error)?
            .as_str()
            .map(str::to_owned))
    }
    async fn input_value(&self, selector: &str) -> Result<Option<String>, EngineError> {
        Ok(self
            .client
            .execute(
                "return document.querySelector(arguments[0])?.value ?? null",
                vec![json!(selector)],
            )
            .await
            .map_err(error)?
            .as_str()
            .map(str::to_owned))
    }
    async fn get_attribute(
        &self,
        selector: &str,
        attribute: &str,
    ) -> Result<Option<String>, EngineError> {
        Ok(self
            .client
            .execute(
                "return document.querySelector(arguments[0])?.getAttribute(arguments[1]) ?? null",
                vec![json!(selector), json!(attribute)],
            )
            .await
            .map_err(error)?
            .as_str()
            .map(str::to_owned))
    }
    async fn is_visible(&self, selector: &str) -> Result<bool, EngineError> {
        Ok(self
            .query_selector(selector)
            .await?
            .is_some_and(|element| element.is_visible))
    }
    async fn is_enabled(&self, selector: &str) -> Result<bool, EngineError> {
        Ok(self
            .query_selector(selector)
            .await?
            .is_some_and(|element| element.is_enabled))
    }
    async fn wait_for_selector(&self, selector: &str, timeout_ms: u64) -> Result<(), EngineError> {
        tokio::time::timeout(Duration::from_millis(timeout_ms), async {
            loop {
                if self.count(selector).await? > 0 {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .map_err(|_| EngineError::Timeout(format!("selector {selector}")))?
    }
    async fn scroll_into_view(&self, selector: &str) -> Result<(), EngineError> {
        let found=self.client.execute("const e=document.querySelector(arguments[0]); if(!e)return false; e.scrollIntoView({block:'center',inline:'center'}); return true",vec![json!(selector)]).await.map_err(error)?;
        if found == true {
            Ok(())
        } else {
            Err(EngineError::ElementNotFound(selector.into()))
        }
    }
    async fn evaluate(&self, script: &str) -> Result<Value, EngineError> {
        self.client
            .execute("return (0,eval)(arguments[0])", vec![json!(script)])
            .await
            .map_err(error)
    }
    async fn read_browser_version_page(&self) -> Result<Value, EngineError> {
        let previous = self.client.window().await.map_err(error)?;
        let tab = self.client.new_window(true).await.map_err(error)?;
        let read = async {
            self.client
                .switch_to_window(tab.handle)
                .await
                .map_err(error)?;
            self.client.goto("chrome://version").await.map_err(error)?;
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let value = self.evaluate(crate::parity::VERSION_EXPRESSION).await?;
                    if !value.is_null() {
                        return Ok::<_, EngineError>(value);
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            })
            .await
            .map_err(|_| EngineError::Timeout("chrome://version did not render".into()))?
        }
        .await;
        let _ = self.client.close_window().await;
        let _ = self.client.switch_to_window(previous).await;
        read
    }
    async fn restore_storage_state(&self, state: Value) -> Result<(), EngineError> {
        self.restore_state(serde_json::from_value(state).map_err(error)?)
            .await
            .map_err(error)
    }
    async fn export_storage_state(&self) -> Result<Value, EngineError> {
        serde_json::to_value(self.save_state().await.map_err(error)?).map_err(error)
    }
    async fn delete_cookies(&self, cookies: Vec<Value>) -> Result<(), EngineError> {
        for cookie in cookies {
            if let Some(bidi) = &self.bidi {
                bidi.send("storage.deleteCookies", json!({"filter":{"name":cookie["name"],"domain":cookie["domain"],"path":cookie["path"]}})).await.map_err(error)?;
            } else {
                self.client
                    .delete_cookie(cookie["name"].as_str().unwrap_or(""))
                    .await
                    .map_err(error)?;
            }
        }
        Ok(())
    }
    async fn screenshot(&self) -> Result<Vec<u8>, EngineError> {
        self.client.screenshot().await.map_err(error)
    }
    async fn pdf(&self, options: PdfOptions) -> Result<Vec<u8>, EngineError> {
        self.require_feature("PDF")?;
        use fantoccini::wd::{PrintConfiguration, PrintMargins, PrintSize};
        let size = match options.format.as_deref().unwrap_or("A4") {
            "A4" => PrintSize::A4,
            "Letter" => PrintSize::US_LETTER,
            "Legal" => PrintSize::US_LEGAL,
            other => {
                return Err(error(format!(
                    "Unsupported WebDriver paper format: {other}"
                )))
            }
        };
        fn cm(value: Option<&str>) -> Result<f64, EngineError> {
            let Some(value) = value else { return Ok(1.0) };
            for (unit, factor) in [("cm", 1.0), ("mm", 0.1), ("in", 2.54), ("px", 2.54 / 96.0)] {
                if let Some(number) = value.strip_suffix(unit) {
                    return number
                        .trim()
                        .parse::<f64>()
                        .map(|n| n * factor)
                        .map_err(error);
                }
            }
            value.parse().map_err(error)
        }
        let margins = PrintMargins {
            top: cm(options.margin_top.as_deref())?,
            bottom: cm(options.margin_bottom.as_deref())?,
            left: cm(options.margin_left.as_deref())?,
            right: cm(options.margin_right.as_deref())?,
        };
        let config = PrintConfiguration::builder()
            .size(size)
            .background(options.print_background)
            .scale(options.scale.unwrap_or(1.0))
            .margins(margins)
            .build()
            .map_err(error)?;
        let bytes = self.client.print(config).await.map_err(error)?;
        if let Some(path) = options.path {
            std::fs::write(path, &bytes).map_err(error)?;
        }
        Ok(bytes)
    }
    async fn bring_to_front(&self) -> Result<(), EngineError> {
        let handle = self.client.window().await.map_err(error)?;
        self.client.switch_to_window(handle).await.map_err(error)
    }
    async fn wait_for_navigation(&self, timeout_ms: u64) -> Result<(), EngineError> {
        tokio::time::timeout(Duration::from_millis(timeout_ms), async {
            loop {
                if self.evaluate("document.readyState").await? == "complete" {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .map_err(|_| EngineError::Timeout("document readiness".into()))?
    }
    async fn keyboard_press(&self, keys: &str) -> Result<(), EngineError> {
        let values = keys.split('+').map(key).collect::<Result<Vec<_>, _>>()?;
        let mut actions = values
            .iter()
            .map(|value| KeyAction::Down { value: *value })
            .collect::<Vec<_>>();
        actions.extend(
            values
                .into_iter()
                .rev()
                .map(|value| KeyAction::Up { value }),
        );
        self.keys(actions).await
    }
    async fn keyboard_type(&self, text: &str) -> Result<(), EngineError> {
        self.client
            .active_element()
            .await
            .map_err(error)?
            .send_keys(text)
            .await
            .map_err(error)
    }
    async fn keyboard_down(&self, value: &str) -> Result<(), EngineError> {
        self.keys(vec![KeyAction::Down { value: key(value)? }])
            .await
    }
    async fn keyboard_up(&self, value: &str) -> Result<(), EngineError> {
        self.keys(vec![KeyAction::Up { value: key(value)? }]).await
    }
}
