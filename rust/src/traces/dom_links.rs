//! DOM content in Links Notation, read from the authoritative bundle members.
use super::{
    jsonfmt::{Json, JsonObject},
    links::{field, Link},
};
use std::{collections::HashSet, fs, path::Path};

fn link(name: &str, values: Vec<Option<Link>>) -> Link {
    Link::new(name, values.into_iter().flatten().collect())
}

pub(crate) fn event_links(
    root: &Path,
    event: &JsonObject,
    dom: &str,
    seen: &mut HashSet<String>,
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
    let Ok(body) = fs::read_to_string(root.join(member)) else {
        return links;
    };
    for line in body.lines() {
        let Ok(batch) = Json::parse(line) else {
            continue;
        };
        let key = format!(
            "{member}:{}:{}:{}",
            batch.get("frameId").unwrap_or(&Json::Null).to_compact(),
            batch.get("sequence").unwrap_or(&Json::Null).to_compact(),
            batch.get("at").unwrap_or(&Json::Null).to_compact()
        );
        if !seen.insert(key) {
            continue;
        }
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
