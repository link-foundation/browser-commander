/**
 * A tiny DER (ASN.1) reader, just enough to walk the structures NSS writes into
 * Firefox's `key4.db` and the base64 blobs in `logins.json`. It is deliberately
 * minimal: it understands the tags those structures use (SEQUENCE, OCTET
 * STRING, INTEGER, OBJECT IDENTIFIER) and returns a small tree, so the NSS
 * decryption code can read fields by position without a full ASN.1 library
 * (there is no DER dependency in this project).
 */

export const DER_TAG = Object.freeze({
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  SEQUENCE: 0x30,
});

/**
 * Decode one DER element at `offset`.
 *
 * @param {Buffer} buffer
 * @param {number} [offset=0]
 * @returns {{tag: number, length: number, header: number, contentStart: number, end: number, content: Buffer, children: Array|null}}
 */
export function decodeDerElement(buffer, offset = 0) {
  const tag = buffer[offset];
  let cursor = offset + 1;
  let length = buffer[cursor];
  cursor += 1;
  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      length = length * 256 + buffer[cursor];
      cursor += 1;
    }
  }
  const contentStart = cursor;
  const end = contentStart + length;
  const content = buffer.subarray(contentStart, end);
  const constructed = (tag & 0x20) !== 0;
  return {
    tag,
    length,
    header: contentStart - offset,
    contentStart,
    end,
    content,
    children: constructed ? decodeDerSequence(content) : null,
  };
}

/**
 * Decode every element in a constructed value's content.
 *
 * @param {Buffer} content
 * @returns {Array}
 */
export function decodeDerSequence(content) {
  const elements = [];
  let offset = 0;
  while (offset < content.length) {
    const element = decodeDerElement(content, offset);
    elements.push(element);
    offset = element.end;
  }
  return elements;
}

/** Format an OBJECT IDENTIFIER element's bytes as a dotted string. */
export function oidToString(content) {
  const first = Math.floor(content[0] / 40);
  const second = content[0] % 40;
  const parts = [first, second];
  let value = 0;
  for (let i = 1; i < content.length; i += 1) {
    value = value * 128 + (content[i] & 0x7f);
    if ((content[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}
