// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AndroidElementInfo {
    #[serde(rename = "children")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Box<super::super::types::AndroidElementInfo>>>,
    #[serde(rename = "clazz")]
    pub clazz: String,
    #[serde(rename = "desc")]
    pub desc: String,
    #[serde(rename = "res")]
    pub res: String,
    #[serde(rename = "pkg")]
    pub pkg: String,
    #[serde(rename = "text")]
    pub text: String,
    #[serde(rename = "bounds")]
    pub bounds: Box<super::super::types::Rect>,
    #[serde(rename = "checkable")]
    pub checkable: bool,
    #[serde(rename = "checked")]
    pub checked: bool,
    #[serde(rename = "clickable")]
    pub clickable: bool,
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "focusable")]
    pub focusable: bool,
    #[serde(rename = "focused")]
    pub focused: bool,
    #[serde(rename = "longClickable")]
    pub long_clickable: bool,
    #[serde(rename = "scrollable")]
    pub scrollable: bool,
    #[serde(rename = "selected")]
    pub selected: bool,
}
