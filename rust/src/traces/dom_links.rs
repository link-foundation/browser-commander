//! DOM content in Links Notation, read from the authoritative bundle members.
use super::{
    jsonfmt::{Json, JsonObject},
    links::{field, Link},
};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

fn link(name: &str, values: Vec<Option<Link>>) -> Link {
    Link::new(name, values.into_iter().flatten().collect())
}

pub(crate) fn event_links(
    root: &Path,
    event: &JsonObject,
    dom: &str,
    seen: &mut (String, u64),
) -> Vec<Link> {
    let mut links = Vec::new();
    let kind = event.get("kind").and_then(Json::as_str).unwrap_or("");
    if kind == "checkpoint" {
        let members = event.get("members");
        let member = members
            .and_then(|value| value.get(if dom == "text" { "state" } else { "html" }))
            .and_then(Json::as_str);
        if let Some(member) = member {
            if let Ok(body) = fs::read_to_string(root.join(member)) {
                let value = if dom == "text" {
                    Json::parse(&body)
                        .ok()
                        .and_then(|value| value.get("text").cloned())
                        .unwrap_or(Json::Null)
                } else {
                    Json::from(body)
                };
                links.push(link(
                    if dom == "text" {
                        "dom-text"
                    } else {
                        "dom-snapshot"
                    },
                    vec![
                        field("checkpoint", event.get("index")),
                        field(if dom == "text" { "text" } else { "html" }, Some(&value)),
                    ],
                ));
            }
        }
    }
    if kind != "mutations" {
        return links;
    }
    let Some(member) = event.get("member").and_then(Json::as_str) else {
        return links;
    };
    let path = root.join(member).to_string_lossy().into_owned();
    if seen.0 != path {
        *seen = (path, 0);
    }
    let Ok(mut source) = fs::File::open(root.join(member)) else {
        return links;
    };
    if source.seek(SeekFrom::Start(seen.1)).is_err() {
        return links;
    }
    let mut body = String::new();
    if source.read_to_string(&mut body).is_err() {
        return links;
    }
    seen.1 += body.len() as u64;
    for line in body.lines() {
        let Ok(batch) = Json::parse(line) else {
            continue;
        };
        for record in batch
            .get("records")
            .and_then(Json::as_array)
            .into_iter()
            .flatten()
        {
            if dom != "text" {
                links.push(link(
                    "dom-mutation",
                    vec![
                        field("at", batch.get("at")),
                        field("record", Some(&Json::from(record.to_compact()))),
                    ],
                ));
                continue;
            }
            let target = record.get("target");
            if target.and_then(|value| value.get("visible")) == Some(&Json::Bool(false)) {
                continue;
            }
            let kind = record.get("kind").and_then(Json::as_str).unwrap_or("");
            if kind == "attributes" || kind == "characterData" {
                links.push(link(
                    if kind == "attributes" {
                        "attribute-changed"
                    } else {
                        "text-changed"
                    },
                    vec![
                        field("at", batch.get("at")),
                        field("path", target.and_then(|value| value.get("path"))),
                        field("attribute", record.get("attribute")),
                        field("before", record.get("before")),
                        field("after", record.get("after")),
                    ],
                ));
            }
            if kind == "childList" {
                for change in ["added", "removed"] {
                    for node in record
                        .get(change)
                        .and_then(Json::as_array)
                        .into_iter()
                        .flatten()
                    {
                        if node.get("visible") != Some(&Json::Bool(false))
                            && node.get("text").is_some_and(Json::truthy)
                        {
                            links.push(link(
                                &format!("text-{change}"),
                                vec![
                                    field("at", batch.get("at")),
                                    field(
                                        "path",
                                        node.get("path")
                                            .or_else(|| target.and_then(|value| value.get("path"))),
                                    ),
                                    field("text", node.get("text")),
                                ],
                            ));
                        }
                    }
                }
            }
        }
    }
    links
}
