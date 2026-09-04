//! Sending a CDP command chromiumoxide has no generated type for.
//!
//! chromiumoxide's `Page::execute` takes a `Command`, and the crate generates
//! one type per protocol method from the PDL. That is a good API until the
//! command has to be chosen at runtime: the fingerprint module builds its
//! command list as `(method, params)` pairs so that JavaScript, Python and Rust
//! can be checked against the same expectations. `RawCdpCommand` closes the
//! gap -- `Method::identifier` supplies the method name and `Serialize` the
//! params object, which is all the connection needs to build a `MethodCall`.

use std::borrow::Cow;

use anyhow::{Context, Result};
use async_trait::async_trait;
use chromiumoxide::types::MethodId;
use chromiumoxide::{Command, Method};
use serde::{Serialize, Serializer};
use serde_json::Value;

use crate::browser::chromiumoxide_adapter::ChromiumoxidePage;
use crate::fingerprint::apply::CdpTransport;

/// A CDP command named at runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawCdpCommand {
    method: String,
    params: Value,
}

impl RawCdpCommand {
    /// Build a command for `method` with `params` as its payload.
    pub fn new(method: impl Into<String>, params: Value) -> Self {
        Self {
            method: method.into(),
            params,
        }
    }
}

impl Serialize for RawCdpCommand {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Only the params are serialized: the method name travels in the
        // `method` field of the enclosing MethodCall, which the connection
        // fills from `identifier()`.
        self.params.serialize(serializer)
    }
}

impl Method for RawCdpCommand {
    fn identifier(&self) -> MethodId {
        Cow::Owned(self.method.clone())
    }
}

impl Command for RawCdpCommand {
    // Nothing here inspects the reply, and a runtime-named command has no type
    // to deserialize into anyway, so the raw JSON is the response.
    type Response = Value;
}

#[async_trait]
impl CdpTransport for ChromiumoxidePage {
    async fn send(&self, method: &str, params: Value) -> Result<Value> {
        let response = self
            .raw_page()
            .execute(RawCdpCommand::new(method, params))
            .await
            .with_context(|| format!("{method} failed"))?;
        Ok(response.result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn carries_the_method_name_out_of_band() {
        let command = RawCdpCommand::new("Emulation.setLocaleOverride", json!({ "locale": "de" }));

        assert_eq!(command.identifier(), "Emulation.setLocaleOverride");
        assert_eq!(command.domain_name(), "Emulation");
    }

    #[test]
    fn serializes_to_the_params_object_alone() {
        // A method name inside the params would be sent to Chrome as an unknown
        // argument, which is an error for most commands.
        let command = RawCdpCommand::new("Page.enable", json!({}));

        assert_eq!(
            serde_json::to_value(&command).expect("serialize"),
            json!({})
        );
    }

    #[test]
    fn keeps_the_params_exactly_as_given() {
        let params = json!({ "source": "globalThis.x = 1;", "nested": { "a": [1, 2] } });
        let command = RawCdpCommand::new("Page.addScriptToEvaluateOnNewDocument", params.clone());

        assert_eq!(serde_json::to_value(&command).expect("serialize"), params);
    }
}
