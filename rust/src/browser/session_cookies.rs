//! Runtime cookies share normalization across startup and portable state.
use crate::core::engine::{EngineAdapter, EngineError, EngineType};
use serde_json::{json, Value};

pub fn normalize_session_cookies(cookies: Vec<Value>, engine: EngineType) -> Vec<Value> {
    cookies
        .into_iter()
        .map(|mut cookie| {
            if cookie
                .get("expires")
                .and_then(Value::as_f64)
                .is_none_or(|expiry| expiry <= 0.0)
            {
                if let Some(object) = cookie.as_object_mut() {
                    if engine == EngineType::Playwright {
                        object.insert("expires".into(), json!(-1));
                    } else {
                        object.remove("expires");
                    }
                }
            }
            if let Some(site) = cookie.get("sameSite").and_then(Value::as_str) {
                cookie["sameSite"] = json!(match site.to_lowercase().as_str() {
                    "strict" => "Strict",
                    "lax" => "Lax",
                    _ => "None",
                });
            }
            cookie
        })
        .collect()
}
pub async fn set_cookies(page: &dyn EngineAdapter, cookies: Vec<Value>) -> Result<(), EngineError> {
    page.restore_storage_state(
        json!({"cookies": normalize_session_cookies(cookies, page.engine_type()), "origins": []}),
    )
    .await
}
pub async fn clear_cookies(
    page: &dyn EngineAdapter,
    domain: Option<&str>,
) -> Result<usize, EngineError> {
    let state = page.export_storage_state().await?;
    let cookies: Vec<_> = state
        .get("cookies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|cookie| {
            domain.is_none_or(|domain| {
                super::migration::domains::matches_domains(
                    cookie.get("domain").and_then(Value::as_str).unwrap_or(""),
                    &[domain.to_string()],
                )
            })
        })
        .cloned()
        .collect();
    let count = cookies.len();
    page.delete_cookies(cookies).await?;
    Ok(count)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nonpositive_expiry_is_session_state_for_each_engine() {
        for engine in [
            EngineType::Chromiumoxide,
            EngineType::Playwright,
            EngineType::Puppeteer,
            EngineType::Fantoccini,
        ] {
            let cookies = normalize_session_cookies(
                vec![
                    json!({"expires":0,"name":"session"}),
                    json!({"expires":42,"name":"persistent"}),
                ],
                engine,
            );
            assert_eq!(cookies[1]["expires"], 42);
            assert!(cookies[0].get("expires").is_none() || cookies[0]["expires"] == -1);
        }
    }
}
