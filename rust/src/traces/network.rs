//! Opt-in bounded network metadata and HAR using the same recorded events.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NetworkTraceOptions {
    pub resource_types: Vec<String>,
    /// URL substring filter.
    pub url_pattern: Option<String>,
    pub bodies: bool,
    pub max_body_bytes: usize,
    pub har: bool,
}
impl Default for NetworkTraceOptions {
    fn default() -> Self {
        Self {
            resource_types: Vec::new(),
            url_pattern: None,
            bodies: false,
            max_body_bytes: 1024 * 1024,
            har: false,
        }
    }
}
impl NetworkTraceOptions {
    pub fn allows(&self, url: &str, resource: &str) -> bool {
        (self.resource_types.is_empty() || self.resource_types.iter().any(|r| r == resource))
            && self
                .url_pattern
                .as_ref()
                .is_none_or(|pattern| url.contains(pattern))
    }
}
pub(crate) fn headers(value: &Value) -> Value {
    Value::Object(
        value
            .as_object()
            .into_iter()
            .flatten()
            .map(|(key, value)| {
                let key = key.to_lowercase();
                let value = if [
                    "cookie",
                    "authorization",
                    "proxy-authorization",
                    "set-cookie",
                ]
                .contains(&key.as_str())
                {
                    json!("[redacted]")
                } else {
                    value.clone()
                };
                (key, value)
            })
            .collect(),
    )
}
fn har_headers(value: &Value) -> Value {
    json!(value.as_object().into_iter().flatten().map(|(name,value)|json!({"name":name,"value":value.as_str().map(str::to_owned).unwrap_or_else(||value.to_string())})).collect::<Vec<_>>())
}
pub(crate) fn write_har(root: &std::path::Path) -> Result<(), super::TraceRecordError> {
    let opened =
        super::read_trace(root).map_err(|e| super::TraceRecordError::Invalid(e.to_string()))?;
    let values = opened.events;
    let requests = values
        .iter()
        .filter(|e| e["kind"] == "network.request")
        .map(|e| (e["requestId"].to_string(), e))
        .collect::<std::collections::HashMap<_, _>>();
    let entries=values.iter().filter(|e|e["kind"]=="network.response").map(|response| {
        let request=requests.get(&response["requestId"].to_string()).copied().unwrap_or(response);
        let timing = &response["timing"];
        let request_start = timing["requestStart"].as_f64().unwrap_or(0.0);
        let response_start = timing["responseStart"].as_f64().unwrap_or(0.0);
        let response_end = timing["responseEnd"].as_f64().unwrap_or(0.0);
        let mut content=json!({"size":response["body"]["size"].as_u64().unwrap_or(0),"mimeType":response["contentType"].as_str().unwrap_or("")});
        if !response["body"].is_null() {content["text"]=response["body"]["data"].clone();content["encoding"]=json!("base64");content["_truncated"]=response["body"]["truncated"].clone();}
        let mut req=json!({"method":request["method"],"url":request["url"],"httpVersion":"HTTP/1.1","headers":har_headers(&request["headers"]),"cookies":[],"queryString":[],"headersSize":-1,"bodySize":-1});
        if let Some(data)=request["postData"].as_str() {req["postData"]=json!({"mimeType":request["headers"]["content-type"].as_str().unwrap_or(""),"text":data});}
        json!({"startedDateTime":request["at"],"time":response["timing"]["responseEnd"].as_f64().unwrap_or(0.0),"request":req,"response":{"status":response["status"],"statusText":response["statusText"],"httpVersion":"HTTP/1.1","headers":har_headers(&response["headers"]),"cookies":[],"redirectURL":"","headersSize":-1,"bodySize":response["body"]["size"].as_i64().unwrap_or(-1),"content":content},"cache":{},"timings":{"send":0,"wait":(response_start-request_start).max(0.0),"receive":(response_end-response_start).max(0.0)},"_resourceType":response["resourceType"]})
    }).collect::<Vec<_>>();
    let data=serde_json::to_vec_pretty(&json!({"log":{"version":"1.2","creator":{"name":"browser-commander","version":env!("CARGO_PKG_VERSION")},"entries":entries}})).map_err(|e|super::TraceRecordError::Invalid(e.to_string()))?;
    crate::capture_encoding::private_write(root.join("network.har"), &data)?;
    Ok(())
}
