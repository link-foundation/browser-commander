use super::ManagedWebDriver;
use crate::browser::storage_state::StorageState;
use anyhow::{anyhow, Result};
use serde_json::json;

impl ManagedWebDriver {
    /// Restore portable state with native WebDriver and return to the current
    /// URL. Local storage remains origin scoped; HttpOnly cookies use WebDriver.
    pub async fn restore_state(&self, state: StorageState) -> Result<()> {
        let previous = self.client.current_url().await?;
        let restore=async {
            for value in state.cookies {
                let name=value["name"].as_str().ok_or_else(||anyhow!("cookie.name is required"))?;
                let content=value["value"].as_str().ok_or_else(||anyhow!("cookie.value is required"))?;
                let domain=value["domain"].as_str().ok_or_else(||anyhow!("cookie.domain is required"))?;
                if let Some(bidi) = &self.bidi {
                    let mut cookie=json!({"name":name,"value":{"type":"string","value":content},"domain":domain,
                        "path":value["path"].as_str().unwrap_or("/"),"httpOnly":value["httpOnly"].as_bool().unwrap_or(false),
                        "secure":value["secure"].as_bool().unwrap_or(false),
                        "sameSite":value["sameSite"].as_str().unwrap_or("Lax").to_ascii_lowercase()});
                    if let Some(expires)=value["expires"].as_f64().filter(|value|*value>0.0){cookie["expiry"]=json!(expires);}
                    bidi.send("storage.setCookie",json!({"cookie":cookie})).await?;
                    continue;
                }
                let scheme=if value["secure"].as_bool()==Some(true){"https"}else{"http"};
                let origin=state.origins.iter().find(|origin|url::Url::parse(&origin.origin).is_ok_and(|url|url.host_str()==Some(domain.trim_start_matches('.'))))
                    .map(|origin|origin.origin.clone()).unwrap_or_else(||format!("{scheme}://{}/",domain.trim_start_matches('.')));
                self.client.goto(&origin).await?;
                let mut cookie=cookie::Cookie::new(name.to_owned(),content.to_owned());
                cookie.set_domain(domain.to_owned());
                cookie.set_path(value["path"].as_str().unwrap_or("/").to_owned());
                cookie.set_http_only(value["httpOnly"].as_bool().unwrap_or(false));
                cookie.set_secure(value["secure"].as_bool().unwrap_or(false));
                cookie.set_same_site(match value["sameSite"].as_str().unwrap_or("Lax") {"Strict"=>cookie::SameSite::Strict,"None"=>cookie::SameSite::None,_=>cookie::SameSite::Lax});
                if let Some(expires)=value["expires"].as_f64().filter(|value| *value>0.0) {
                    cookie.set_expires(time::OffsetDateTime::from_unix_timestamp(expires as i64)?);
                }
                self.client.add_cookie(cookie).await?;
            }
            for origin in state.origins {
                self.client.goto(&origin.origin).await?;
                self.client.execute("for(const item of arguments[0]) localStorage.setItem(item.name,item.value)",vec![serde_json::to_value(origin.local_storage)?]).await?;
            }
            Ok::<(),anyhow::Error>(())
        }.await;
        let returned = self.client.goto(previous.as_str()).await;
        restore?;
        returned?;
        Ok(())
    }

    /// Export browser cookies through BiDi where available, otherwise the
    /// current domain via W3C WebDriver, plus the active origin's localStorage.
    pub async fn save_state(&self) -> Result<StorageState> {
        let cookies = if let Some(bidi) = &self.bidi {
            let response = bidi.send("storage.getCookies", json!({})).await?;
            response["cookies"].as_array().ok_or_else(||anyhow!("Invalid BiDi cookies"))?.iter().map(|cookie|json!({
                "name":cookie["name"],"value":cookie["value"]["value"],"domain":cookie["domain"],"path":cookie["path"],
                "secure":cookie["secure"],"httpOnly":cookie["httpOnly"],"expires":cookie.get("expiry").cloned().unwrap_or(json!(-1)),
                "sameSite":match cookie["sameSite"].as_str().unwrap_or("lax") {"strict"=>"Strict","none"=>"None",_=>"Lax"}
            })).collect()
        } else {
            self.client.get_all_cookies().await?.into_iter().map(|cookie|json!({
                "name":cookie.name(),"value":cookie.value(),"domain":cookie.domain().unwrap_or(""),"path":cookie.path().unwrap_or("/"),
                "secure":cookie.secure().unwrap_or(false),"httpOnly":cookie.http_only().unwrap_or(false),
                "expires":cookie.expires_datetime().map(|value|value.unix_timestamp()).unwrap_or(-1),
                "sameSite":cookie.same_site().map(|value|format!("{value:?}")).unwrap_or_else(||"Lax".into())
            })).collect()
        };
        let origin = self
            .client
            .execute("return location.origin", vec![])
            .await?;
        let origins = if origin
            .as_str()
            .is_some_and(|value| value.starts_with("http://") || value.starts_with("https://"))
        {
            let entries = self
                .client
                .execute(
                    "return Object.entries(localStorage).map(([name,value])=>({name,value}))",
                    vec![],
                )
                .await?;
            serde_json::from_value(json!([{"origin":origin,"localStorage":entries}]))?
        } else {
            Vec::new()
        };
        Ok(StorageState { cookies, origins })
    }
}
