// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AndroidSelectorHasChild {
    #[serde(rename = "androidSelector")]
    pub android_selector: Box<super::super::types::AndroidSelector>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AndroidSelectorHasDescendant {
    #[serde(rename = "androidSelector")]
    pub android_selector: Box<super::super::types::AndroidSelector>,
    #[serde(rename = "maxDepth")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<i64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AndroidSelector {
    #[serde(rename = "checkable")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkable: Option<bool>,
    #[serde(rename = "checked")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    #[serde(rename = "clazz")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clazz: Option<String>,
    #[serde(rename = "clickable")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clickable: Option<bool>,
    #[serde(rename = "depth")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<i64>,
    #[serde(rename = "desc")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    #[serde(rename = "enabled")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(rename = "focusable")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focusable: Option<bool>,
    #[serde(rename = "focused")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused: Option<bool>,
    #[serde(rename = "hasChild")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_child: Option<AndroidSelectorHasChild>,
    #[serde(rename = "hasDescendant")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_descendant: Option<AndroidSelectorHasDescendant>,
    #[serde(rename = "longClickable")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_clickable: Option<bool>,
    #[serde(rename = "pkg")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pkg: Option<String>,
    #[serde(rename = "res")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub res: Option<String>,
    #[serde(rename = "scrollable")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scrollable: Option<bool>,
    #[serde(rename = "selected")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
    #[serde(rename = "text")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}
