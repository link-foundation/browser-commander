//! Framing for the Playwright driver pipe.
//!
//! `playwright run-driver` reads and writes JSON messages prefixed with their
//! byte length as a 4-byte little-endian integer.

use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Upper bound for one message. Screenshots and traces are the largest
/// payloads; anything beyond this is a corrupted length prefix.
pub const MAX_MESSAGE_BYTES: usize = 512 * 1024 * 1024;

/// Read the next message, or `None` at a clean end of stream.
pub async fn read_message<R>(reader: &mut R) -> std::io::Result<Option<Value>>
where
    R: AsyncRead + Unpin + ?Sized,
{
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header).await {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(err) => return Err(err),
    }
    let length = u32::from_le_bytes(header) as usize;
    if length > MAX_MESSAGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Playwright driver message of {length} bytes exceeds the limit"),
        ));
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).await?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
}

/// Write one message and flush it.
pub async fn write_message<W>(writer: &mut W, message: &Value) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin + ?Sized,
{
    let body = serde_json::to_vec(message)?;
    let length = u32::try_from(body.len()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "message is too large")
    })?;
    writer.write_all(&length.to_le_bytes()).await?;
    writer.write_all(&body).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn messages_round_trip_with_a_little_endian_length_prefix() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, &json!({ "id": 1, "method": "goto" }))
            .await
            .unwrap();
        let body_length = buffer.len() - 4;
        assert_eq!(&buffer[..4], &(body_length as u32).to_le_bytes());

        let mut reader = buffer.as_slice();
        let message = read_message(&mut reader).await.unwrap().unwrap();
        assert_eq!(message["method"], "goto");
        assert!(read_message(&mut reader).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn an_oversized_length_prefix_is_rejected() {
        let header = (u32::MAX).to_le_bytes();
        let mut reader = &header[..];
        let error = read_message(&mut reader).await.unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }
}
