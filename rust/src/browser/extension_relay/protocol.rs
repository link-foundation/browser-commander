use async_tungstenite::tungstenite::handshake::server::Request;

use super::{RelayError, RelayOptions};

pub const DEFAULT_RELAY_PORT: u16 = 9333;
pub const RELAY_PATH: &str = "/browser-commander";

pub fn extension_id_from_origin(origin: &str) -> Option<&str> {
    let id = origin.strip_prefix("chrome-extension://")?;
    (!id.is_empty()
        && id
            .bytes()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit()))
    .then_some(id)
}

pub(super) fn authorize(request: &Request, options: &RelayOptions) -> Result<String, u16> {
    if request.uri().path() != RELAY_PATH {
        return Err(404);
    }
    let mut origins = request.headers().get_all("Origin").iter();
    let origin = origins
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(403_u16)?;
    if origins.next().is_some() {
        return Err(403);
    }
    let id = extension_id_from_origin(origin).ok_or(403_u16)?;
    if options
        .allowed_extension_ids
        .as_ref()
        .is_some_and(|ids| !ids.iter().any(|allowed| allowed == id))
    {
        return Err(403);
    }
    Ok(id.to_owned())
}

pub(super) fn validate(options: &RelayOptions) -> Result<(), RelayError> {
    if !matches!(options.host.as_str(), "127.0.0.1" | "::1" | "localhost") {
        return Err(RelayError::InvalidOptions(
            "The extension relay must listen on loopback".into(),
        ));
    }
    if options.timeout.is_zero() || options.request_timeout.is_zero() {
        return Err(RelayError::InvalidOptions(
            "Relay timeouts must be positive".into(),
        ));
    }
    Ok(())
}
