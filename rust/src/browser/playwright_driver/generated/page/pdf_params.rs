// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PdfParamsMargin {
    #[serde(rename = "top")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<String>,
    #[serde(rename = "bottom")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<String>,
    #[serde(rename = "left")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<String>,
    #[serde(rename = "right")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PdfParams {
    #[serde(rename = "scale")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(rename = "displayHeaderFooter")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_header_footer: Option<bool>,
    #[serde(rename = "headerTemplate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_template: Option<String>,
    #[serde(rename = "footerTemplate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer_template: Option<String>,
    #[serde(rename = "printBackground")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub print_background: Option<bool>,
    #[serde(rename = "landscape")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub landscape: Option<bool>,
    #[serde(rename = "pageRanges")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_ranges: Option<String>,
    #[serde(rename = "format")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(rename = "width")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<String>,
    #[serde(rename = "height")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<String>,
    #[serde(rename = "preferCSSPageSize")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefer_css_page_size: Option<bool>,
    #[serde(rename = "margin")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin: Option<PdfParamsMargin>,
    #[serde(rename = "tagged")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagged: Option<bool>,
    #[serde(rename = "outline")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<bool>,
}
