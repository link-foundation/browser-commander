// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SerializedValueV {
    #[serde(rename = "null")]
    Null,
    #[serde(rename = "undefined")]
    Undefined,
    #[serde(rename = "NaN")]
    NaN,
    #[serde(rename = "Infinity")]
    Infinity,
    #[serde(rename = "-Infinity")]
    NegativeInfinity,
    #[serde(rename = "-0")]
    Value0,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SerializedValueTaK {
    #[serde(rename = "i8")]
    I8,
    #[serde(rename = "ui8")]
    Ui8,
    #[serde(rename = "ui8c")]
    Ui8c,
    #[serde(rename = "i16")]
    I16,
    #[serde(rename = "ui16")]
    Ui16,
    #[serde(rename = "i32")]
    I32,
    #[serde(rename = "ui32")]
    Ui32,
    #[serde(rename = "f32")]
    F32,
    #[serde(rename = "f64")]
    F64,
    #[serde(rename = "bi64")]
    Bi64,
    #[serde(rename = "bui64")]
    Bui64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedValueTa {
    #[serde(rename = "b")]
    pub b: String,
    #[serde(rename = "k")]
    pub k: SerializedValueTaK,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedValueE {
    #[serde(rename = "m")]
    pub m: String,
    #[serde(rename = "n")]
    pub n: String,
    #[serde(rename = "s")]
    pub s: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedValueR {
    #[serde(rename = "p")]
    pub p: String,
    #[serde(rename = "f")]
    pub f: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedValueOItem {
    #[serde(rename = "k")]
    pub k: String,
    #[serde(rename = "v")]
    pub v: Box<super::super::types::SerializedValue>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedValue {
    #[serde(rename = "n")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n: Option<f64>,
    #[serde(rename = "b")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<bool>,
    #[serde(rename = "s")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<String>,
    #[serde(rename = "v")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub v: Option<SerializedValueV>,
    #[serde(rename = "d")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub d: Option<String>,
    #[serde(rename = "u")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub u: Option<String>,
    #[serde(rename = "bi")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bi: Option<String>,
    #[serde(rename = "ta")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ta: Option<SerializedValueTa>,
    #[serde(rename = "e")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub e: Option<SerializedValueE>,
    #[serde(rename = "r")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r: Option<SerializedValueR>,
    #[serde(rename = "a")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a: Option<Vec<Box<super::super::types::SerializedValue>>>,
    #[serde(rename = "o")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub o: Option<Vec<SerializedValueOItem>>,
    #[serde(rename = "h")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<i64>,
    #[serde(rename = "fn")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#fn: Option<String>,
    #[serde(rename = "id")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    #[serde(rename = "ref")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<i64>,
}
