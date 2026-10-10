//! Compress closed NDJSON members; readers accept raw and gzip files.
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use std::{
    fs,
    io::{self, Read},
    path::Path,
};
pub(crate) fn read_text(path: &Path) -> io::Result<String> {
    match fs::read_to_string(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let file = fs::File::open(format!("{}.gz", path.display()))?;
            let mut text = String::new();
            GzDecoder::new(file).read_to_string(&mut text)?;
            Ok(text)
        }
        result => result,
    }
}
pub(crate) fn gzip_trace(root: &Path) -> io::Result<()> {
    for item in fs::read_dir(root)? {
        let path = item?.path();
        if path.is_dir() {
            gzip_trace(&path)?;
            continue;
        }
        if path
            .extension()
            .is_some_and(|extension| extension == "ndjson")
        {
            let temporary = format!("{}.gz.tmp", path.display());
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut target = GzEncoder::new(options.open(&temporary)?, Compression::default());
            io::copy(&mut fs::File::open(&path)?, &mut target)?;
            target.finish()?;
            fs::rename(temporary, format!("{}.gz", path.display()))?;
            fs::remove_file(path)?;
        }
    }
    Ok(())
}
