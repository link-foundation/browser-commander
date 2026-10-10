//! Typed capture with bounded frame recording and explicit capability errors.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::core::engine::{EngineAdapter, EngineError};
use crate::utilities::subprocess::{run_command, RunCommandOptions};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenshotFormat {
    #[default]
    Png,
    Jpeg,
    Webp,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenshotScale {
    Css,
    #[default]
    Device,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenshotAnimations {
    #[default]
    Allow,
    Disabled,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenshotCaret {
    Hide,
    #[default]
    Initial,
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScreenshotClip {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScreenshotOptions {
    pub path: Option<PathBuf>,
    pub full_page: bool,
    pub selector: Option<String>,
    pub clip: Option<ScreenshotClip>,
    pub format: ScreenshotFormat,
    pub quality: Option<u8>,
    pub scale: ScreenshotScale,
    pub omit_background: bool,
    pub animations: ScreenshotAnimations,
    pub caret: ScreenshotCaret,
    pub hide_scrollbars: bool,
    pub hide_caret: bool,
    pub disable_animations: bool,
    pub wait_for_fonts: bool,
}
impl ScreenshotOptions {
    pub fn validate(&self) -> Result<(), EngineError> {
        if self.quality.is_some_and(|quality| quality > 100)
            || (self.quality.is_some() && self.format == ScreenshotFormat::Png)
        {
            return Err(EngineError::Browser(
                "quality must be 0–100 for JPEG/WebP".into(),
            ));
        }
        if usize::from(self.selector.is_some())
            + usize::from(self.clip.is_some())
            + usize::from(self.full_page)
            > 1
        {
            return Err(EngineError::Browser(
                "selector, clip and full_page are mutually exclusive".into(),
            ));
        }
        if self.clip.is_some_and(|c| {
            ![c.x, c.y, c.width, c.height].iter().all(|n| n.is_finite())
                || c.x < 0.0
                || c.y < 0.0
                || c.width <= 0.0
                || c.height <= 0.0
        }) {
            return Err(EngineError::Browser("invalid screenshot clip".into()));
        }
        Ok(())
    }
    pub(crate) fn native(&self) -> Value {
        let mut value = json!({"type":self.format,"fullPage":self.full_page,"scale":self.scale,"omitBackground":self.omit_background,
            "animations": if self.disable_animations {ScreenshotAnimations::Disabled} else {self.animations},
            "caret": ScreenshotCaret::Initial});
        if let Some(quality) = self.quality {
            value["quality"] = json!(quality);
        }
        if let Some(clip) = self.clip {
            value["clip"] = json!(clip);
        }
        let mut style = String::new();
        if self.hide_scrollbars {
            style.push_str(
                "*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}",
            );
        }
        if self.hide_caret || self.caret == ScreenshotCaret::Hide {
            style.push_str("*{caret-color:transparent!important}");
        }
        if !style.is_empty() {
            value["style"] = json!(style);
        }
        value
    }
}
pub fn unsupported<E: EngineAdapter + ?Sized>(
    adapter: &E,
    feature: impl Into<String>,
) -> EngineError {
    EngineError::Unsupported {
        browser: adapter.engine_type().to_string(),
        feature: feature.into(),
    }
}

pub async fn screenshot(
    adapter: &dyn EngineAdapter,
    options: &ScreenshotOptions,
) -> Result<Vec<u8>, EngineError> {
    options.validate()?;
    let mut native = options.clone();
    native.path = None;
    if let Some(selector) = &options.selector {
        let element = adapter
            .query_selector(selector)
            .await?
            .ok_or_else(|| EngineError::ElementNotFound(selector.clone()))?;
        let (x, y, width, height) = element
            .bounding_box
            .ok_or_else(|| EngineError::ElementNotFound(selector.clone()))?;
        native.selector = None;
        native.clip = Some(ScreenshotClip {
            x,
            y,
            width,
            height,
        });
    }
    if options.wait_for_fonts {
        adapter
            .evaluate("async () => { await document.fonts.ready; return true; }")
            .await?;
    }
    native.wait_for_fonts = false;
    let bytes = adapter.screenshot_with_options(&native).await?;
    if let Some(path) = &options.path {
        crate::capture_encoding::private_write(path, &bytes)?;
    }
    Ok(bytes)
}

/// Encode animations natively; an explicit ffmpeg option enables the companion video backend.
pub async fn encode_animation(frames: &[Vec<u8>], options: Value) -> Result<Vec<u8>, EngineError> {
    if frames.is_empty()
        || frames.len() > 1000
        || frames.iter().map(Vec::len).sum::<usize>() > 64 * 1024 * 1024
    {
        return Err(EngineError::Browser(
            "encoding requires 1–1000 frames within 64 MiB".into(),
        ));
    }
    if ["gif", "apng", "webp"].contains(&options["format"].as_str().unwrap_or("gif")) {
        return crate::capture_encoding::encode(frames, &options);
    }
    let cli = std::env::var_os("BROWSER_COMMANDER_JS_CLI")
        .map(PathBuf::from)
        .or_else(|| {
            Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js/bin/browser-commander.js"))
        })
        .filter(|p| p.is_file())
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.join("node_modules/browser-commander/bin/browser-commander.js"))
                .filter(|p| p.is_file())
        });
    let worker = cli.and_then(|p| p.parent()?.parent().map(|p|p.join("src/capture/worker.js"))).filter(|p|p.is_file())
        .ok_or_else(|| EngineError::Unsupported { browser: "Rust codec backend".into(), feature: "install the companion browser-commander npm package or set BROWSER_COMMANDER_JS_CLI".into() })?;
    let input = json!({"frames":frames.iter().map(|f|STANDARD.encode(f)).collect::<Vec<_>>(),"options":options}).to_string();
    let output = run_command(
        &std::env::var("BROWSER_COMMANDER_NODE").unwrap_or_else(|_| "node".into()),
        &[worker.to_string_lossy().into_owned()],
        RunCommandOptions {
            input: Some(input),
            check: false,
            ..Default::default()
        },
    )
    .await
    .map_err(|e| EngineError::Unsupported {
        browser: "codec worker".into(),
        feature: e.to_string(),
    })?;
    let value: Value =
        serde_json::from_str(&output.stdout).map_err(|e| EngineError::Browser(e.to_string()))?;
    if let Some(error) = value.get("error") {
        return Err(EngineError::Unsupported {
            browser: "codec worker".into(),
            feature: error["message"]
                .as_str()
                .unwrap_or("encoding failed")
                .into(),
        });
    }
    STANDARD
        .decode(value["data"].as_str().unwrap_or(""))
        .map_err(|e| EngineError::Browser(e.to_string()))
}

#[derive(Debug, Clone)]
pub struct RecordingOptions {
    pub fps: u32,
    pub max_frames: usize,
    pub max_bytes: usize,
    pub max_duration: Duration,
    pub screenshot: ScreenshotOptions,
    pub encoding: Value,
}
impl Default for RecordingOptions {
    fn default() -> Self {
        Self {
            fps: 10,
            max_frames: 1000,
            max_bytes: 64 * 1024 * 1024,
            max_duration: Duration::from_secs(60),
            screenshot: ScreenshotOptions::default(),
            encoding: json!({"format":"webm"}),
        }
    }
}
#[derive(Debug, Clone)]
pub struct RecordingResult {
    pub frames: Vec<Vec<u8>>,
    pub bytes: Option<Vec<u8>>,
    pub truncated: bool,
}
pub struct Recording {
    adapter: Arc<dyn EngineAdapter>,
    options: RecordingOptions,
    stop: tokio::sync::watch::Sender<bool>,
    task: Option<tokio::task::JoinHandle<Result<RecordingResult, EngineError>>>,
    result: Option<RecordingResult>,
}
pub async fn start_recording(
    adapter: Arc<dyn EngineAdapter>,
    options: RecordingOptions,
) -> Result<Recording, EngineError> {
    if !(1..=60).contains(&options.fps)
        || !(1..=1000).contains(&options.max_frames)
        || options.max_bytes == 0
        || options.max_duration.is_zero()
    {
        return Err(EngineError::Browser("invalid recording budget".into()));
    }
    let format = options.encoding["format"].as_str().unwrap_or("frames");
    if !["frames", "gif", "apng", "webp", "webm", "mp4", "mov"].contains(&format) {
        return Err(unsupported(adapter.as_ref(), format));
    }
    if ["webm", "mp4", "mov"].contains(&format) && options.encoding.get("ffmpeg").is_none() {
        let supported = adapter
            .evaluate(&format!(
                "() => !!globalThis.MediaRecorder?.isTypeSupported({})",
                json!(format!("video/{format}"))
            ))
            .await?;
        if supported != json!(true) {
            return Err(unsupported(adapter.as_ref(), format));
        }
    }
    let first = screenshot(adapter.as_ref(), &options.screenshot).await?;
    if first.len() > options.max_bytes {
        return Err(EngineError::Browser("first frame exceeds max_bytes".into()));
    }
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    let page = adapter.clone();
    let config = options.clone();
    let task = tokio::spawn(async move {
        let mut result = RecordingResult {
            frames: vec![first],
            bytes: None,
            truncated: false,
        };
        let started = std::time::Instant::now();
        let mut bytes = result.frames[0].len();
        loop {
            tokio::select! { _ = stopped.changed() => break, _ = tokio::time::sleep(Duration::from_secs_f64(1.0/f64::from(config.fps))) => {} }
            if result.frames.len() >= config.max_frames || started.elapsed() >= config.max_duration
            {
                result.truncated = true;
                break;
            }
            let frame = screenshot(page.as_ref(), &config.screenshot).await?;
            bytes += frame.len();
            if bytes > config.max_bytes {
                result.truncated = true;
                break;
            }
            result.frames.push(frame);
        }
        Ok(result)
    });
    Ok(Recording {
        adapter,
        options,
        stop,
        task: Some(task),
        result: None,
    })
}
impl Recording {
    pub async fn stop(&mut self) -> Result<RecordingResult, EngineError> {
        if let Some(result) = &self.result {
            return Ok(result.clone());
        }
        let _ = self.stop.send(true);
        let mut result = self
            .task
            .take()
            .ok_or_else(|| EngineError::Browser("recording already stopped".into()))?
            .await
            .map_err(|e| EngineError::Browser(e.to_string()))??;
        let mut options = self.options.encoding.clone();
        options["fps"] = json!(self.options.fps);
        let format = options["format"].as_str().unwrap_or("frames");
        if format != "frames" {
            let data = if ["webm", "mp4", "mov"].contains(&format)
                && options.get("ffmpeg").is_none()
            {
                let args = json!({"frames":result.frames.iter().map(|f|STANDARD.encode(f)).collect::<Vec<_>>(),"format":format,"fps":self.options.fps,"quality":options.get("quality"),"size":options.get("size")});
                let source = &crate::traces::assets::trace_assets().capture.encode_video;
                let value = self
                    .adapter
                    .evaluate(&format!("async () => await ({source})({args})"))
                    .await?;
                if value.get("unsupported").is_some() {
                    return Err(unsupported(self.adapter.as_ref(), format));
                }
                value["data"]
                    .as_array()
                    .ok_or_else(|| EngineError::Browser("video encoder returned no bytes".into()))?
                    .iter()
                    .map(|v| v.as_u64().unwrap_or(0) as u8)
                    .collect()
            } else {
                encode_animation(&result.frames, options.clone()).await?
            };
            if let Some(path) = options["path"].as_str() {
                crate::capture_encoding::private_write(path, &data)?;
            }
            result.bytes = Some(data);
        }
        self.result = Some(result.clone());
        Ok(result)
    }
}
impl Drop for Recording {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::stub_engine::StubEngine;
    #[tokio::test]
    async fn unsupported_options_are_explicit() {
        let engine = StubEngine::fixed("about:blank");
        let options = ScreenshotOptions {
            full_page: true,
            ..Default::default()
        };
        assert!(matches!(
            screenshot(&engine, &options).await,
            Err(EngineError::Unsupported { .. })
        ));
    }
}
