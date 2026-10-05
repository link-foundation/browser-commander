//! Validate source/target boundaries before writing browser data.

use std::path::Path;

use anyhow::{anyhow, Result};

use super::{MigrateProfileOptions, ALL_DATA_CLASSES};
use crate::browser::{
    browser_profile_files::physical_path, browser_sources::browser_family,
    system_browser::assert_dedicated_user_data_dir,
};

pub(crate) fn validate_options(options: &MigrateProfileOptions) -> Result<()> {
    if options
        .include
        .iter()
        .any(|class| !ALL_DATA_CLASSES.contains(&class.as_str()))
    {
        return Err(anyhow!(
            "include must contain supported data classes: {}",
            ALL_DATA_CLASSES.join(", ")
        ));
    }
    if options.domains.iter().any(|domain| {
        domain.is_empty()
            || domain
                .chars()
                .any(|c| c.is_whitespace() || c == '/' || c == ':')
    }) {
        return Err(anyhow!("domains must be an array of host names"));
    }
    if let Some(target) = &options.target_browser {
        if browser_family(target)? != "chromium" {
            return Err(anyhow!(
                "Migration target {target} does not yet have a supported target file writer"
            ));
        }
    }
    assert_dedicated_user_data_dir(&options.to)
}

pub(crate) fn validate_paths(source: &Path, target: &Path) -> Result<()> {
    let source = physical_path(source)?;
    let target = physical_path(target)?;
    if source.starts_with(&target) || target.starts_with(&source) {
        return Err(anyhow!(
            "Migration source and target directories must not overlap"
        ));
    }
    Ok(())
}
