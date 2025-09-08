#!/usr/bin/env node
/**
 * Wemp Service Version Updater
 *
 * Checks for new service versions and updates versions.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USER_AGENT = 'Mozilla/5.0 (compatible; Wemp-Version-Updater/1.0; +https://github.com/electronfriends/wemp)';

/**
 * Compare two semantic version strings
 */
function isNewerVersion(newVersion, currentVersion) {
  if (!currentVersion) return true;
  
  const parseVersion = (v) => v.split('.').map(Number);
  const [newMajor, newMinor, newPatch] = parseVersion(newVersion);
  const [curMajor, curMinor, curPatch] = parseVersion(currentVersion);
  
  if (newMajor !== curMajor) return newMajor > curMajor;
  if (newMinor !== curMinor) return newMinor > curMinor;
  return newPatch > curPatch;
}

/**
 * Fetch JSON data from URL with timeout
 */
async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Check if URL returns a valid zip file
 */
async function isValidZip(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000)
    });

    return response.ok && url.endsWith('.zip');
  } catch {
    return false;
  }
}

/**
 * Service version fetchers for each supported service
 */
const serviceFetchers = {
  async nginx() {
    const tags = await fetchJson('https://api.github.com/repos/nginx/nginx/tags');
    const releaseTag = tags.find(tag => /^release-\d+\.\d+\.\d+$/.test(tag.name));
    if (releaseTag) {
      const version = releaseTag.name.replace('release-', '');
      const downloadUrl = `https://nginx.org/download/nginx-${version}.zip`;

      if (!(await isValidZip(downloadUrl))) {
        throw new Error('Invalid download URL');
      }

      return { version, downloadUrl };
    }
    return null;
  },

  async mariadb() {
    const data = await fetchJson('https://api.github.com/repos/MariaDB/server/releases/latest');
    const version = data.tag_name.replace(/^mariadb-/, '');
    const downloadUrl = `https://archive.mariadb.org/mariadb-${version}/winx64-packages/mariadb-${version}-winx64.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return { version, downloadUrl };
  },

  async php() {
    // Keep PHP at 8.3.x for phpMyAdmin compatibility
    // NOTE: When upgrading to PHP 8.4+, change vs16 to vs17 in URLs below
    const tags = await fetchJson('https://api.github.com/repos/php/php-src/tags');
    const phpTag = tags.find(tag => tag.name.startsWith('php-8.3.'));
    if (phpTag) {
      const version = phpTag.name.replace('php-', '');
      const primaryUrl = `https://windows.php.net/downloads/releases/php-${version}-nts-Win32-vs16-x64.zip`;
      const archiveUrl = `https://windows.php.net/downloads/releases/archives/php-${version}-nts-Win32-vs16-x64.zip`;

      // Try primary URL first, then archive
      if (await isValidZip(primaryUrl)) {
        return { version, downloadUrl: primaryUrl };
      } else if (await isValidZip(archiveUrl)) {
        return { version, downloadUrl: archiveUrl };
      }

      throw new Error('No valid download URL found');
    }
    return null;
  },

  async phpmyadmin() {
    const data = await fetchJson('https://api.github.com/repos/phpmyadmin/phpmyadmin/releases/latest');
    const version = data.tag_name.replace(/^RELEASE_/, '').replace(/_/g, '.');
    const downloadUrl = `https://files.phpmyadmin.net/phpMyAdmin/${version}/phpMyAdmin-${version}-all-languages.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return { version, downloadUrl };
  }
};

/**
 * Main function to check and update service versions
 */
async function updateVersions() {
  const versionsPath = path.join(__dirname, '../api/wemp/versions.json');

  console.log('📄 Reading current versions...');
  let versions;
  try {
    versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
  } catch (error) {
    console.error('❌ Failed to read versions.json:', error);
    throw error;
  }

  let hasUpdates = false;
  const services = Object.keys(serviceFetchers);

  for (const service of services) {
    try {
      const latestInfo = await serviceFetchers[service]();

      if (latestInfo && isNewerVersion(latestInfo.version, versions[service]?.version)) {
        const currentVersion = versions[service]?.version || 'none';
        console.log(`📦 ${service}: ${currentVersion} → ${latestInfo.version}`);
        versions[service] = {
          version: latestInfo.version,
          downloadUrl: latestInfo.downloadUrl
        };
        hasUpdates = true;
      }
    } catch (error) {
      console.error(`❌ ${service}: ${error.message}`);
    }
  }

  if (hasUpdates) {
    fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n');
    console.log('✅ Updated versions.json');
  } else {
    console.log('✅ No updates needed');
  }
}

// Run the updater
updateVersions()
  .catch(error => {
    console.error('❌ Update failed:', error);
    process.exit(1);
  });
