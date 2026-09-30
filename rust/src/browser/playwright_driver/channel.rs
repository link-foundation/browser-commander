//! Typed protocol channel references and command results.
use playwright_rs::server::connection::Connection;
use serde::{de::DeserializeOwned, Serialize};
use std::{marker::PhantomData, sync::Arc};

#[derive(Clone, Debug, Default)]
pub struct AnyChannel;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(bound = "")]
pub struct ChannelRef<T> {
    pub guid: String,
    #[serde(skip)]
    kind: PhantomData<T>,
}
impl<T> ChannelRef<T> {
    pub fn new(guid: impl Into<String>) -> Self {
        Self {
            guid: guid.into(),
            kind: PhantomData,
        }
    }
}

#[derive(Clone)]
pub struct Channel<T> {
    connection: Arc<Connection>,
    reference: ChannelRef<T>,
}
impl<T: Clone> Channel<T> {
    pub fn new(connection: Arc<Connection>, guid: String) -> Self {
        Self {
            connection,
            reference: ChannelRef::new(guid),
        }
    }
    pub fn reference(&self) -> ChannelRef<T> {
        self.reference.clone()
    }
    pub fn connection(&self) -> Arc<Connection> {
        self.connection.clone()
    }
    pub async fn call<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        params: P,
    ) -> playwright_rs::Result<R> {
        let result = self
            .connection
            .send_message(
                self.reference.guid.clone(),
                method.into(),
                serde_json::to_value(params)?,
            )
            .await?;
        // Protocol commands without returns produce an absent/null result.
        Ok(serde_json::from_value(if result.is_null() {
            serde_json::json!({})
        } else {
            result
        })?)
    }
}
