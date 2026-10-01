//! JSON that keeps the key order JavaScript would keep.
//!
//! A trace is compared byte for byte across JavaScript, Python and Rust, and a
//! JavaScript object serializes its keys in insertion order (array-index keys
//! first, ascending). `serde_json::Value` sorts keys unless the crate-wide
//! `preserve_order` feature is on, and switching that on would change every
//! other `serde_json` user in the dependency tree. This module is the small
//! ordered value the recorder writes instead, with `JSON.stringify` output.

use std::fmt;

use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};

/// A JSON value whose objects keep JavaScript's key order.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Json {
    /// `null`.
    #[default]
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// Every number is a double, as in JavaScript.
    Number(f64),
    /// A string.
    String(String),
    /// An array.
    Array(Vec<Json>),
    /// An object, in JavaScript property order.
    Object(JsonObject),
}

/// An object whose keys iterate the way a JavaScript object's do.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct JsonObject {
    entries: Vec<(String, Json)>,
}

/// Whether JavaScript treats `key` as an array index, which it orders first.
fn is_array_index(key: &str) -> bool {
    if key.is_empty() || key.len() > 10 || !key.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if key.len() > 1 && key.starts_with('0') {
        return false;
    }
    key.parse::<u64>()
        .map(|n| n < u64::from(u32::MAX))
        .unwrap_or(false)
}

impl JsonObject {
    /// An empty object.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set `key`, keeping its position when it already exists.
    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<Json>) {
        let key = key.into();
        let value = value.into();
        if let Some(slot) = self.entries.iter_mut().find(|(name, _)| *name == key) {
            slot.1 = value;
            return;
        }
        if is_array_index(&key) {
            let number: u64 = key.parse().unwrap_or(0);
            let at = self
                .entries
                .iter()
                .position(|(name, _)| {
                    !is_array_index(name) || name.parse::<u64>().unwrap_or(0) > number
                })
                .unwrap_or(self.entries.len());
            self.entries.insert(at, (key, value));
        } else {
            self.entries.push((key, value));
        }
    }

    /// Builder form of [`JsonObject::insert`].
    pub fn with(mut self, key: impl Into<String>, value: impl Into<Json>) -> Self {
        self.insert(key, value);
        self
    }

    /// Copy every entry of `other` over this object, like `{ ...this, ...other }`.
    pub fn extend_from(&mut self, other: &JsonObject) {
        for (key, value) in &other.entries {
            self.insert(key.clone(), value.clone());
        }
    }

    /// The value at `key`, if present.
    pub fn get(&self, key: &str) -> Option<&Json> {
        self.entries
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value)
    }

    /// Remove `key`, returning its value.
    pub fn remove(&mut self, key: &str) -> Option<Json> {
        let at = self.entries.iter().position(|(name, _)| name == key)?;
        Some(self.entries.remove(at).1)
    }

    /// Whether `key` is present.
    pub fn contains_key(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Entries in JavaScript order.
    pub fn iter(&self) -> impl Iterator<Item = (&String, &Json)> {
        self.entries.iter().map(|(key, value)| (key, value))
    }

    /// Number of entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the object has no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Json {
    /// Parse JSON text the way `JSON.parse` does: a repeated key keeps its
    /// first position and its last value.
    pub fn parse(text: &str) -> Result<Json, serde_json::Error> {
        serde_json::from_str(text)
    }

    /// `JSON.stringify(value)`.
    pub fn to_compact(&self) -> String {
        let mut out = String::new();
        write_value(&mut out, self, None, 0);
        out
    }

    /// `JSON.stringify(value, null, 2)`.
    pub fn to_pretty(&self) -> String {
        let mut out = String::new();
        write_value(&mut out, self, Some(2), 0);
        out
    }

    /// The object, when this is one.
    pub fn as_object(&self) -> Option<&JsonObject> {
        match self {
            Json::Object(object) => Some(object),
            _ => None,
        }
    }

    /// The array, when this is one.
    pub fn as_array(&self) -> Option<&Vec<Json>> {
        match self {
            Json::Array(items) => Some(items),
            _ => None,
        }
    }

    /// The string, when this is one.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(text) => Some(text),
            _ => None,
        }
    }

    /// The number, when this is one.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Number(number) => Some(*number),
            _ => None,
        }
    }

    /// The value at `key` of an object.
    pub fn get(&self, key: &str) -> Option<&Json> {
        self.as_object().and_then(|object| object.get(key))
    }

    /// Whether this is `null`.
    pub fn is_null(&self) -> bool {
        matches!(self, Json::Null)
    }

    /// JavaScript truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            Json::Null => false,
            Json::Bool(value) => *value,
            Json::Number(number) => *number != 0.0 && !number.is_nan(),
            Json::String(text) => !text.is_empty(),
            Json::Array(_) | Json::Object(_) => true,
        }
    }

    /// Convert to a `serde_json::Value`; objects come out key-sorted unless
    /// the caller enabled `preserve_order`.
    pub fn to_value(&self) -> serde_json::Value {
        match self {
            Json::Null => serde_json::Value::Null,
            Json::Bool(value) => serde_json::Value::Bool(*value),
            Json::Number(number) => {
                if number.fract() == 0.0 && number.abs() < 9_007_199_254_740_992.0 {
                    serde_json::Value::from(*number as i64)
                } else {
                    serde_json::Number::from_f64(*number)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                }
            }
            Json::String(text) => serde_json::Value::String(text.clone()),
            Json::Array(items) => {
                serde_json::Value::Array(items.iter().map(Json::to_value).collect())
            }
            Json::Object(object) => serde_json::Value::Object(
                object
                    .iter()
                    .map(|(key, value)| (key.clone(), value.to_value()))
                    .collect(),
            ),
        }
    }
}

/// JavaScript's `String(value)` for a value that may be missing (`undefined`).
pub fn js_string(value: Option<&Json>) -> String {
    match value {
        None => "undefined".to_string(),
        Some(Json::Null) => "null".to_string(),
        Some(Json::Bool(value)) => value.to_string(),
        Some(Json::Number(number)) => js_number(*number),
        Some(Json::String(text)) => text.clone(),
        Some(Json::Array(items)) => items
            .iter()
            .map(|item| match item {
                Json::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Json::Object(_)) => "[object Object]".to_string(),
    }
}

/// `left !== right` negated, for values that may be missing (`undefined`).
/// Objects and arrays read from JSON are never the same reference.
pub fn js_strict_equal(left: Option<&Json>, right: Option<&Json>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(Json::Null), Some(Json::Null)) => true,
        (Some(Json::Bool(a)), Some(Json::Bool(b))) => a == b,
        (Some(Json::Number(a)), Some(Json::Number(b))) => a == b,
        (Some(Json::String(a)), Some(Json::String(b))) => a == b,
        _ => false,
    }
}

/// Length in UTF-16 code units, which is what JavaScript's `length` counts.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `Number.prototype.toString()` for a double.
pub fn js_number(number: f64) -> String {
    if number.is_nan() {
        return "NaN".to_string();
    }
    if number.is_infinite() {
        return if number > 0.0 {
            "Infinity"
        } else {
            "-Infinity"
        }
        .to_string();
    }
    if number == 0.0 {
        return "0".to_string();
    }
    let sign = if number < 0.0 { "-" } else { "" };
    // `{:e}` prints the shortest digits that round-trip, as ECMAScript asks.
    let formatted = format!("{:e}", number.abs());
    let (mantissa, exponent) = formatted.split_once('e').unwrap_or((&formatted, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exponent: i64 = exponent.parse().unwrap_or(0);
    let k = digits.len() as i64;
    let n = exponent + 1;

    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(n as usize);
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let e_sign = if e < 0 { '-' } else { '+' };
        if k == 1 {
            format!("{digits}e{e_sign}{}", e.abs())
        } else {
            let (first, rest) = digits.split_at(1);
            format!("{first}.{rest}e{e_sign}{}", e.abs())
        }
    };
    format!("{sign}{body}")
}

fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn newline(out: &mut String, indent: Option<usize>, depth: usize) {
    if let Some(width) = indent {
        out.push('\n');
        out.push_str(&" ".repeat(width * depth));
    }
}

fn write_value(out: &mut String, value: &Json, indent: Option<usize>, depth: usize) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Json::Number(number) => {
            if number.is_finite() {
                out.push_str(&js_number(*number));
            } else {
                out.push_str("null");
            }
        }
        Json::String(text) => write_string(out, text),
        Json::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (at, item) in items.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                write_value(out, item, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push(']');
        }
        Json::Object(object) => {
            if object.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (at, (key, item)) in object.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                write_string(out, key);
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_value(out, item, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push('}');
        }
    }
}

impl fmt::Display for Json {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_compact())
    }
}

struct JsonVisitor;

impl<'de> Visitor<'de> for JsonVisitor {
    type Value = Json;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Json, E> {
        Ok(Json::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Json, E> {
        Ok(Json::Number(value as f64))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Json, E> {
        Ok(Json::Number(value as f64))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Json, E> {
        Ok(Json::Number(value))
    }

    fn visit_str<E>(self, value: &str) -> Result<Json, E> {
        Ok(Json::String(value.to_string()))
    }

    fn visit_string<E>(self, value: String) -> Result<Json, E> {
        Ok(Json::String(value))
    }

    fn visit_unit<E>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }

    fn visit_none<E>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Json, D::Error> {
        Deserialize::deserialize(deserializer)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Json::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
        let mut object = JsonObject::new();
        while let Some((key, value)) = map.next_entry::<String, Json>()? {
            object.insert(key, value);
        }
        Ok(Json::Object(object))
    }
}

impl<'de> Deserialize<'de> for Json {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Json, D::Error> {
        deserializer.deserialize_any(JsonVisitor)
    }
}

impl From<&serde_json::Value> for Json {
    fn from(value: &serde_json::Value) -> Self {
        match value {
            serde_json::Value::Null => Json::Null,
            serde_json::Value::Bool(value) => Json::Bool(*value),
            serde_json::Value::Number(number) => Json::Number(number.as_f64().unwrap_or(f64::NAN)),
            serde_json::Value::String(text) => Json::String(text.clone()),
            serde_json::Value::Array(items) => Json::Array(items.iter().map(Json::from).collect()),
            serde_json::Value::Object(map) => {
                let mut object = JsonObject::new();
                for (key, item) in map {
                    object.insert(key.clone(), Json::from(item));
                }
                Json::Object(object)
            }
        }
    }
}

impl From<serde_json::Value> for Json {
    fn from(value: serde_json::Value) -> Self {
        Json::from(&value)
    }
}

impl From<&str> for Json {
    fn from(value: &str) -> Self {
        Json::String(value.to_string())
    }
}

impl From<String> for Json {
    fn from(value: String) -> Self {
        Json::String(value)
    }
}

impl From<&String> for Json {
    fn from(value: &String) -> Self {
        Json::String(value.clone())
    }
}

impl From<bool> for Json {
    fn from(value: bool) -> Self {
        Json::Bool(value)
    }
}

impl From<f64> for Json {
    fn from(value: f64) -> Self {
        Json::Number(value)
    }
}

macro_rules! json_from_integer {
    ($($kind:ty),*) => {
        $(impl From<$kind> for Json {
            fn from(value: $kind) -> Self {
                Json::Number(value as f64)
            }
        })*
    };
}

json_from_integer!(i32, i64, u32, u64, usize);

impl From<JsonObject> for Json {
    fn from(value: JsonObject) -> Self {
        Json::Object(value)
    }
}

impl From<Vec<Json>> for Json {
    fn from(value: Vec<Json>) -> Self {
        Json::Array(value)
    }
}

impl<T: Into<Json>> From<Option<T>> for Json {
    fn from(value: Option<T>) -> Self {
        value.map(Into::into).unwrap_or(Json::Null)
    }
}

impl FromIterator<(String, Json)> for JsonObject {
    fn from_iter<I: IntoIterator<Item = (String, Json)>>(iter: I) -> Self {
        let mut object = JsonObject::new();
        for (key, value) in iter {
            object.insert(key, value);
        }
        object
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_like_javascript() {
        let cases = [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (2.0, "2"),
            (0.25, "0.25"),
            (1234.5, "1234.5"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (123e18, "123000000000000000000"),
            (1e-7, "1e-7"),
            (1.25e-7, "1.25e-7"),
            (0.000001, "0.000001"),
            (0.1 + 0.2, "0.30000000000000004"),
            (-42.0, "-42"),
            (1767225600000.0, "1767225600000"),
        ];
        for (number, expected) in cases {
            assert_eq!(js_number(number), expected, "{number}");
        }
    }

    #[test]
    fn objects_keep_javascript_key_order() {
        let parsed = Json::parse(r#"{"b":1,"a":2,"10":3,"2":4,"b":5,"01":6}"#).unwrap();
        assert_eq!(parsed.to_compact(), r#"{"2":4,"10":3,"b":5,"a":2,"01":6}"#);
    }

    #[test]
    fn strings_escape_like_json_stringify() {
        let value = Json::from("a\"b\\c\n\u{1}\u{2028}✓");
        assert_eq!(value.to_compact(), "\"a\\\"b\\\\c\\n\\u0001\u{2028}✓\"");
    }

    #[test]
    fn pretty_output_matches_json_stringify_with_two_spaces() {
        let value = Json::parse(r#"{"a":[1,{"b":[]}],"c":{}}"#).unwrap();
        assert_eq!(
            value.to_pretty(),
            "{\n  \"a\": [\n    1,\n    {\n      \"b\": []\n    }\n  ],\n  \"c\": {}\n}"
        );
    }
}
