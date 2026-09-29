//! A tiny DER (ASN.1) reader, mirroring `js/src/browser/migration/firefox-der.js`.
//!
//! It is just enough to walk the structures NSS writes into Firefox's `key4.db`
//! and the base64 blobs in `logins.json` (SEQUENCE, OCTET STRING, INTEGER,
//! OBJECT IDENTIFIER), so the NSS decryption code can read fields by position
//! without a full ASN.1 dependency. Unlike the JavaScript reader, truncated
//! input is an error instead of reading past the end of the buffer.

use anyhow::{anyhow, Result};

/// One decoded DER element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DerElement {
    pub tag: u8,
    pub length: usize,
    /// Header size (tag + length bytes).
    pub header: usize,
    pub content_start: usize,
    pub end: usize,
    pub content: Vec<u8>,
    /// Decoded children of a constructed element (`tag & 0x20`).
    pub children: Option<Vec<DerElement>>,
}

fn byte_at(buffer: &[u8], index: usize) -> Result<u8> {
    buffer
        .get(index)
        .copied()
        .ok_or_else(|| anyhow!("DER value is truncated"))
}

/// Decode one DER element at `offset`.
pub(crate) fn decode_der_element(buffer: &[u8], offset: usize) -> Result<DerElement> {
    let tag = byte_at(buffer, offset)?;
    let mut cursor = offset + 1;
    let mut length = usize::from(byte_at(buffer, cursor)?);
    cursor += 1;
    if length & 0x80 != 0 {
        let length_bytes = length & 0x7f;
        length = 0;
        for _ in 0..length_bytes {
            length = length
                .checked_mul(256)
                .and_then(|value| value.checked_add(usize::from(buffer.get(cursor).copied()?)))
                .ok_or_else(|| anyhow!("DER length is invalid"))?;
            cursor += 1;
        }
    }
    let content_start = cursor;
    let end = content_start
        .checked_add(length)
        .filter(|end| *end <= buffer.len())
        .ok_or_else(|| anyhow!("DER value is truncated"))?;
    let content = buffer[content_start..end].to_vec();
    let children = if tag & 0x20 != 0 {
        Some(decode_der_sequence(&content)?)
    } else {
        None
    };
    Ok(DerElement {
        tag,
        length,
        header: content_start - offset,
        content_start,
        end,
        content,
        children,
    })
}

/// Decode every element in a constructed value's content.
pub(crate) fn decode_der_sequence(content: &[u8]) -> Result<Vec<DerElement>> {
    let mut elements = Vec::new();
    let mut offset = 0;
    while offset < content.len() {
        let element = decode_der_element(content, offset)?;
        offset = element.end;
        elements.push(element);
    }
    Ok(elements)
}

/// The children of an element, decoding primitive content as a sequence.
pub(crate) fn der_children(element: &DerElement) -> Result<Vec<DerElement>> {
    match &element.children {
        Some(children) => Ok(children.clone()),
        None => decode_der_sequence(&element.content),
    }
}

/// Format an OBJECT IDENTIFIER element's bytes as a dotted string.
pub(crate) fn oid_to_string(content: &[u8]) -> String {
    let Some(first_byte) = content.first() else {
        return String::new();
    };
    let mut parts = vec![u64::from(first_byte / 40), u64::from(first_byte % 40)];
    let mut value: u64 = 0;
    for byte in &content[1..] {
        value = value.wrapping_mul(128) + u64::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            parts.push(value);
            value = 0;
        }
    }
    parts
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join(".")
}
