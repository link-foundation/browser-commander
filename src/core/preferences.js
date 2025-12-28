import path from 'path';
import fs from 'fs/promises';

/**
 * Disables Chrome translate feature by modifying the Preferences file
 * @param {Object} options - Configuration options
 * @param {string} options.userDataDir - Path to Chrome user data directory
 */
export async function disableTranslateInPreferences(options = {}) {
  const { userDataDir } = options;

  if (!userDataDir) {
    throw new Error('userDataDir is required in options');
  }
  const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
  const defaultDir = path.join(userDataDir, 'Default');

  try {
    await fs.mkdir(defaultDir, { recursive: true });

    let preferences = {};

    try {
      const content = await fs.readFile(preferencesPath, 'utf8');
      preferences = JSON.parse(content);
    } catch {
      // File doesn't exist yet, will create new one
    }

    if (!preferences.translate) {
      preferences.translate = {};
    }
    preferences.translate.enabled = false;

    await fs.writeFile(
      preferencesPath,
      JSON.stringify(preferences, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error(
      '⚠️  Warning: Could not modify Preferences file:',
      error.message
    );
  }
}
