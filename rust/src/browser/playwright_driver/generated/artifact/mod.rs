// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod cancel_params;
pub mod cancel_result;
pub mod delete_params;
pub mod delete_result;
pub mod failure_params;
pub mod failure_result;
pub mod initializer;
mod methods_0;
pub mod path_after_finished_params;
pub mod path_after_finished_result;
pub mod save_as_params;
pub mod save_as_result;
pub mod save_as_stream_params;
pub mod save_as_stream_result;
pub mod stream_params;
pub mod stream_result;
#[derive(Clone)]
pub struct ArtifactChannel(pub Channel<super::types::Artifact>);
impl ArtifactChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Artifact> {
        self.0.reference()
    }
}
