//! Native CDP network events, bounded opt-in payloads and default credential redaction.
use crate::{
    core::{EngineError, TraceEngineEvent},
    traces::network::{headers, NetworkTraceOptions},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chromiumoxide::{
    cdp::browser_protocol::network::{
        EventLoadingFailed, EventLoadingFinished, EventRequestWillBeSent, EventResponseReceived,
        GetResponseBodyParams,
    },
    Page,
};
use futures::{
    stream::{self, BoxStream},
    StreamExt,
};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
async fn events<T>(
    page: &Page,
    kind: &'static str,
) -> Result<BoxStream<'static, (&'static str, Value)>, EngineError>
where
    T: chromiumoxide::cdp::IntoEventKind + serde::Serialize + Unpin + Send + Sync + 'static,
{
    Ok(page
        .event_listener::<T>()
        .await
        .map_err(|e| EngineError::Browser(e.to_string()))?
        .map(move |event| {
            (
                kind,
                serde_json::to_value(event.as_ref()).unwrap_or(Value::Null),
            )
        })
        .boxed())
}
pub(crate) async fn observe(
    page: &Page,
    options: NetworkTraceOptions,
) -> Result<BoxStream<'static, TraceEngineEvent>, EngineError> {
    if options.max_body_bytes > 16 * 1024 * 1024 {
        return Err(EngineError::Browser(
            "network max_body_bytes exceeds 16 MiB".into(),
        ));
    }
    let events = stream::select_all(vec![
        events::<EventRequestWillBeSent>(page, "request").await?,
        events::<EventResponseReceived>(page, "response").await?,
        events::<EventLoadingFinished>(page, "finished").await?,
        events::<EventLoadingFailed>(page, "failed").await?,
    ]);
    let page = page.clone();
    let state = (
        events,
        page,
        options,
        HashMap::<String, (Value, f64)>::new(),
        VecDeque::<String>::new(),
    );
    Ok(stream::unfold(state,|mut state|async move {
        while let Some((kind,event))=state.0.next().await {
            let id=event["requestId"].as_str().unwrap_or("").to_owned();
            if kind=="request" {
                let request=&event["request"];let url=request["url"].as_str().unwrap_or("");let resource=event["type"].as_str().unwrap_or("other").to_lowercase();
                if !state.2.allows(url,&resource) {state.3.remove(&id);continue;}
                let timestamp=event["timestamp"].as_f64().unwrap_or(0.0);
                let mut payload=json!({"requestId":format!("{id}:{timestamp}"),"url":url,"method":request["method"],"resourceType":resource,"headers":headers(&request["headers"]),"timing":{"startTime":event["wallTime"].as_f64().unwrap_or(0.0)*1000.0}});
                if state.2.bodies && ["document","xhr","fetch"].contains(&resource.as_str()) {if let Some(body)=request["postData"].as_str() {payload["postData"]=json!(body);payload["postDataTruncated"]=json!(body.len()>state.2.max_body_bytes);}}
                state.3.insert(id.clone(),(payload.clone(),timestamp));state.4.push_back(id);
                while state.4.len()>1024 {if let Some(expired)=state.4.pop_front() {state.3.remove(&expired);}}
                return Some((TraceEngineEvent::Network {kind:"network.request".into(),payload},state));
            }
            let Some((mut payload,started))=state.3.get(&id).cloned() else {continue};
            if kind=="response" {
                let response=&event["response"];payload["status"]=response["status"].clone();payload["statusText"]=response["statusText"].clone();payload["headers"]=headers(&response["headers"]);payload["contentType"]=response["mimeType"].clone();payload["timing"]=response["timing"].clone();
                payload["timing"]["requestStart"]=json!(0.0);
                payload["timing"]["responseStart"]=json!((event["timestamp"].as_f64().unwrap_or(started)-started)*1000.0);
                payload["timing"]["responseEnd"]=payload["timing"]["responseStart"].clone();
                if state.2.bodies && ["document","xhr","fetch"].contains(&payload["resourceType"].as_str().unwrap_or("")) {state.3.insert(id,(payload,started));continue;}
                state.3.remove(&id);
            } else {
                state.3.remove(&id);
                if payload["status"].is_null() {continue;}
                payload["timing"]["responseEnd"]=json!((event["timestamp"].as_f64().unwrap_or(started)-started)*1000.0);
                if kind=="failed" {payload["bodyError"]=event["errorText"].clone();} else {
                    let size=event["encodedDataLength"].as_f64().unwrap_or(0.0) as usize;
                    if !crate::traces::network::text_body(payload["contentType"].as_str().unwrap_or("")) {payload["body"]=json!({"size":size,"omitted":"binary"});} else if size>state.2.max_body_bytes {payload["body"]=json!({"size":size,"truncated":true,"omitted":"size limit"});} else {
                        match tokio::time::timeout(std::time::Duration::from_secs(5),state.1.execute(GetResponseBodyParams::new(id))).await {
                            Ok(Ok(body))=>{let bytes=if body.result.base64_encoded {STANDARD.decode(&body.result.body).unwrap_or_default()} else {body.result.body.as_bytes().to_vec()};payload["body"]=json!({"size":bytes.len(),"truncated":bytes.len()>state.2.max_body_bytes,"encoding":"utf8","data":String::from_utf8_lossy(&bytes).to_string()});}
                            Ok(Err(error))=>payload["bodyError"]=json!(error.to_string()),
                            Err(_)=>payload["bodyError"]=json!("network body timeout"),
                        }
                    }
                }
            }
            return Some((TraceEngineEvent::Network {kind:"network.response".into(),payload},state));
        }
        None
    }).boxed())
}
