//! Pure Rust GIF, APNG and animated WebP codecs; no subprocesses.
use crate::core::EngineError;
use image::{ImageEncoder, RgbaImage};
use serde_json::Value;
use std::{collections::HashMap, io::Cursor};
fn error(e: impl ToString) -> EngineError {
    EngineError::Browser(e.to_string())
}
fn number(options: &Value, key: &str, default: f64) -> f64 {
    options[key].as_f64().unwrap_or(default)
}
fn unsupported(feature: &str) -> EngineError {
    EngineError::Unsupported {
        browser: "Rust animation encoder".into(),
        feature: feature.into(),
    }
}

pub(crate) fn encode(frames: &[Vec<u8>], options: &Value) -> Result<Vec<u8>, EngineError> {
    let format = options["format"].as_str().unwrap_or("gif");
    let fps = number(options, "fps", 10.0);
    let scale = number(options, "scale", 1.0);
    let loops = number(options, "loop", 0.0);
    let palette = number(options, "palette", 256.0);
    if !(1.0..=60.0).contains(&fps)
        || !(0.0..=8.0).contains(&scale)
        || scale == 0.0
        || !(0.0..=65535.0).contains(&loops)
        || loops.fract() != 0.0
        || !(2.0..=256.0).contains(&palette)
        || palette.fract() != 0.0
    {
        return Err(error("invalid fps/scale/loop/palette"));
    }
    if options["dither"] == true && format != "gif" {
        return Err(unsupported("dither"));
    }
    if options.get("quality").is_some() && format == "webp" {
        return Err(unsupported(
            "lossy animated WebP quality; native encoding is lossless",
        ));
    }
    let mut images = Vec::new();
    let mut total = 0_u64;
    for bytes in frames {
        if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
            return Err(error("frame must be PNG"));
        }
        let width = u32::from_be_bytes(bytes[16..20].try_into().map_err(error)?);
        let height = u32::from_be_bytes(bytes[20..24].try_into().map_err(error)?);
        let w = ((width as f64 * scale).round() as u32).max(1);
        let h = ((height as f64 * scale).round() as u32).max(1);
        total += u64::from(w) * u64::from(h) * 4;
        if u64::from(width) * u64::from(height) > 16_777_216 || total > 256 * 1024 * 1024 {
            return Err(error("decoded animation exceeds budget"));
        }
        let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
            .map_err(error)?
            .to_rgba8();
        images.push(image::imageops::resize(
            &image,
            w,
            h,
            image::imageops::FilterType::Nearest,
        ));
    }
    let first = images
        .first()
        .ok_or_else(|| error("animation needs frames"))?;
    if images
        .iter()
        .any(|image| image.dimensions() != first.dimensions())
    {
        return Err(error("frames must have equal dimensions"));
    }
    let data = match format {
        "gif" => gif_frames(
            &images,
            fps,
            loops as u16,
            palette as usize,
            options["dither"] == true,
        )?,
        "apng" => png_frames(&images, fps, loops as u32, options["optimize"] != false)?,
        "webp" => webp_frames(&images, fps, loops as u16)?,
        _ => return Err(unsupported(format)),
    };
    if let Some(path) = options["path"]
        .as_str()
        .or_else(|| options["output"].as_str())
    {
        private_write(path, &data)?;
    }
    Ok(data)
}
pub(crate) fn private_write(
    path: impl AsRef<std::path::Path>,
    bytes: &[u8],
) -> Result<(), EngineError> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(error)?;
    file.write_all(bytes).map_err(error)
}
fn png_frames(
    images: &[RgbaImage],
    fps: f64,
    loops: u32,
    optimize: bool,
) -> Result<Vec<u8>, EngineError> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, images[0].width(), images[0].height());
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(if optimize {
        png::Compression::High
    } else {
        png::Compression::Fast
    });
    encoder
        .set_animated(images.len() as u32, loops)
        .map_err(error)?;
    encoder
        .set_frame_delay((1000.0 / fps).round() as u16, 1000)
        .map_err(error)?;
    let mut writer = encoder.write_header().map_err(error)?;
    for image in images {
        writer.write_image_data(image.as_raw()).map_err(error)?;
    }
    writer.finish().map_err(error)?;
    Ok(bytes)
}
fn gif_frames(
    images: &[RgbaImage],
    fps: f64,
    loops: u16,
    colors: usize,
    dither: bool,
) -> Result<Vec<u8>, EngineError> {
    let mut bytes = Vec::new();
    let width = u16::try_from(images[0].width()).map_err(error)?;
    let height = u16::try_from(images[0].height()).map_err(error)?;
    {
        let mut encoder = gif::Encoder::new(&mut bytes, width, height, &[]).map_err(error)?;
        encoder
            .set_repeat(if loops == 0 {
                gif::Repeat::Infinite
            } else {
                gif::Repeat::Finite(loops)
            })
            .map_err(error)?;
        for image in images {
            let transparent = image.pixels().any(|p| p[3] < 128);
            let mut buckets: HashMap<u16, ([u64; 3], u64)> = HashMap::new();
            for p in image.pixels().filter(|p| p[3] >= 128) {
                let key = (u16::from(p[0] >> 3) << 10)
                    | (u16::from(p[1] >> 3) << 5)
                    | u16::from(p[2] >> 3);
                let entry = buckets.entry(key).or_default();
                for k in 0..3 {
                    entry.0[k] += u64::from(p[k]);
                }
                entry.1 += 1;
            }
            let mut buckets = buckets.into_iter().collect::<Vec<_>>();
            buckets.sort_by(|a, b| b.1 .1.cmp(&a.1 .1).then_with(|| a.0.cmp(&b.0)));
            let mut palette = buckets
                .iter()
                .take(colors - usize::from(transparent))
                .map(|(_, (rgb, count))| rgb.map(|v| (v / count) as u8))
                .collect::<Vec<_>>();
            if palette.is_empty() {
                palette.push([0, 0, 0]);
            }
            let alpha = if transparent {
                let index = palette.len() as u8;
                palette.push([0, 0, 0]);
                Some(index)
            } else {
                None
            };
            let mut pixels = image
                .as_raw()
                .iter()
                .map(|v| f32::from(*v))
                .collect::<Vec<_>>();
            let mut indexed = Vec::with_capacity(width as usize * height as usize);
            for index in 0..(width as usize * height as usize) {
                if pixels[index * 4 + 3] < 128.0 {
                    indexed.push(alpha.unwrap_or(0));
                    continue;
                }
                let selected = palette
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| Some(*i as u8) != alpha)
                    .min_by(|a, b| {
                        let distance = |rgb: &[u8; 3]| {
                            (0..3)
                                .map(|k| (pixels[index * 4 + k] - f32::from(rgb[k])).powi(2))
                                .sum::<f32>()
                        };
                        distance(a.1).total_cmp(&distance(b.1))
                    })
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                indexed.push(selected as u8);
                if dither {
                    for k in 0..3 {
                        let delta = pixels[index * 4 + k] - f32::from(palette[selected][k]);
                        let x = index % width as usize;
                        let y = index / width as usize;
                        for (dx, dy, weight) in [
                            (1, 0, 7.0 / 16.0),
                            (-1, 1, 3.0 / 16.0),
                            (0, 1, 5.0 / 16.0),
                            (1, 1, 1.0 / 16.0),
                        ] {
                            let nx = x as i32 + dx;
                            let ny = y as i32 + dy;
                            if nx >= 0 && nx < i32::from(width) && ny < i32::from(height) {
                                pixels[(ny as usize * width as usize + nx as usize) * 4 + k] +=
                                    delta * weight;
                            }
                        }
                    }
                }
            }
            let mut frame = gif::Frame::from_palette_pixels(
                width,
                height,
                indexed,
                palette.into_iter().flatten().collect::<Vec<_>>(),
                alpha,
            );
            frame.delay = (100.0 / fps).round() as u16;
            frame.dispose = gif::DisposalMethod::Background;
            encoder.write_frame(&frame).map_err(error)?;
        }
    }
    Ok(bytes)
}
fn riff(tag: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut bytes = tag.to_vec();
    bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
    bytes.extend_from_slice(data);
    if data.len() % 2 == 1 {
        bytes.push(0);
    }
    bytes
}
fn write24(bytes: &mut [u8], value: u32, at: usize) {
    bytes[at..at + 3].copy_from_slice(&value.to_le_bytes()[..3]);
}
fn webp_frames(images: &[RgbaImage], fps: f64, loops: u16) -> Result<Vec<u8>, EngineError> {
    let mut extended = [0_u8; 10];
    extended[0] = 0x12;
    write24(&mut extended, images[0].width() - 1, 4);
    write24(&mut extended, images[0].height() - 1, 7);
    let mut animation = [0_u8; 6];
    animation[4..].copy_from_slice(&loops.to_le_bytes());
    let mut payload = b"WEBP".to_vec();
    payload.extend(riff(b"VP8X", &extended));
    payload.extend(riff(b"ANIM", &animation));
    for image in images {
        let mut encoded = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(Cursor::new(&mut encoded))
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(error)?;
        let mut control = [0_u8; 16];
        write24(&mut control, image.width() - 1, 6);
        write24(&mut control, image.height() - 1, 9);
        write24(&mut control, (1000.0 / fps).round() as u32, 12);
        control[15] = 2;
        let mut frame = control.to_vec();
        let mut offset = 12;
        while offset + 8 <= encoded.len() {
            let length =
                u32::from_le_bytes(encoded[offset + 4..offset + 8].try_into().map_err(error)?)
                    as usize;
            let end = offset + 8 + length + (length % 2);
            if end > encoded.len() {
                return Err(error("invalid encoded WebP"));
            }
            let tag = &encoded[offset..offset + 4];
            if tag == b"VP8 " || tag == b"VP8L" || tag == b"ALPH" {
                frame.extend_from_slice(&encoded[offset..end]);
            }
            offset = end;
        }
        payload.extend(riff(b"ANMF", &frame));
    }
    let mut bytes = b"RIFF".to_vec();
    bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes.extend(payload);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn frames() -> Vec<Vec<u8>> {
        [20, 200]
            .into_iter()
            .map(|value| {
                let mut image = RgbaImage::from_pixel(5, 4, image::Rgba([value, 30, 80, 255]));
                image.put_pixel(0, 0, image::Rgba([0, 0, 0, 0]));
                let mut bytes = Vec::new();
                image::codecs::png::PngEncoder::new(&mut bytes)
                    .write_image(image.as_raw(), 5, 4, image::ExtendedColorType::Rgba8)
                    .unwrap();
                bytes
            })
            .collect()
    }
    #[test]
    fn native_gif_has_two_transparent_frames() {
        let bytes = encode(
            &frames(),
            &json!({"format":"gif","dither":true,"palette":16}),
        )
        .unwrap();
        let mut options = gif::DecodeOptions::new();
        options.set_color_output(gif::ColorOutput::RGBA);
        let mut reader = options.read_info(Cursor::new(bytes)).unwrap();
        let mut count = 0;
        while let Some(frame) = reader.read_next_frame().unwrap() {
            count += 1;
            assert_eq!((frame.width, frame.height), (5, 4));
            assert_eq!(frame.buffer[3], 0);
        }
        assert_eq!(count, 2);
    }
    #[test]
    fn native_apng_has_two_frames() {
        let bytes = encode(&frames(), &json!({"format":"apng","loop":3})).unwrap();
        let decoder = png::Decoder::new(Cursor::new(bytes));
        let mut reader = decoder.read_info().unwrap();
        assert_eq!(reader.info().animation_control.unwrap().num_frames, 2);
        assert_eq!(reader.info().animation_control.unwrap().num_plays, 3);
        let mut buffer = vec![0; reader.output_buffer_size().unwrap()];
        for _ in 0..2 {
            let frame = reader.next_frame(&mut buffer).unwrap();
            assert_eq!((frame.width, frame.height), (5, 4));
            assert_eq!(buffer[3], 0);
        }
    }
    #[test]
    fn native_webp_is_an_animation() {
        use image::AnimationDecoder;
        let bytes = encode(&frames(), &json!({"format":"webp"})).unwrap();
        let decoder = image::codecs::webp::WebPDecoder::new(Cursor::new(bytes)).unwrap();
        let frames = decoder.into_frames().collect_frames().unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].buffer().dimensions(), (5, 4));
        assert_eq!(frames[0].buffer().get_pixel(0, 0)[3], 0);
    }
}
