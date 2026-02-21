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
 * Compare two semantic version strings and categorize the update type
 */
function compareVersions(newVersion, currentVersion) {
  if (!currentVersion) return { isNewer: true, updateType: 'major' };

  const parseVersion = (v) => v.split('.').map(Number);
  const [newMajor, newMinor, newPatch] = parseVersion(newVersion);
  const [curMajor, curMinor, curPatch] = parseVersion(currentVersion);

  if (newMajor > curMajor) return { isNewer: true, updateType: 'major' };
  if (newMajor < curMajor) return { isNewer: false, updateType: null };

  if (newMinor > curMinor) return { isNewer: true, updateType: 'minor' };
  if (newMinor < curMinor) return { isNewer: false, updateType: null };

  if (newPatch > curPatch) return { isNewer: true, updateType: 'patch' };

  return { isNewer: false, updateType: null };
}



/**
 * Fetch JSON data from URL with timeout
 */
async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    if (error.name === 'TimeoutError') {
      throw new Error(`Request timeout for ${url}`);
    }
    throw error;
  }
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
  } catch (error) {
    console.warn(`[WARN] Failed to validate ZIP URL ${url}:`, error.message);
    return false;
  }
}



/**
 * Service version fetchers for each supported service
 */
const serviceFetchers = {
  async nginx() {
    const tags = await fetchJson('https://api.github.com/repos/nginx/nginx/tags?per_page=100');
    const nginxVersions = tags
      .filter(tag => /^release-\d+\.\d+\.\d+$/.test(tag.name))
      .map(tag => tag.name.replace('release-', ''))
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
        return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
      });

    if (nginxVersions.length === 0) return null;

    const latestVersion = nginxVersions[0];
    const downloadUrl = `https://nginx.org/download/nginx-${latestVersion}.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return { version: latestVersion, downloadUrl };
  },

  async mariadb() {
    const releases = await fetchJson('https://api.github.com/repos/MariaDB/server/releases?per_page=50');
    const mariadbVersions = releases
      .filter(release => !release.prerelease && !release.draft)
      .map(release => release.tag_name.replace(/^mariadb-/, ''))
      .filter(version => /^\d+\.\d+\.\d+$/.test(version))
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
        return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
      });

    if (mariadbVersions.length === 0) return null;

    const latestVersion = mariadbVersions[0];
    const downloadUrl = `https://archive.mariadb.org/mariadb-${latestVersion}/winx64-packages/mariadb-${latestVersion}-winx64.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return { version: latestVersion, downloadUrl };
  },

  async php() {
    const releasesData = await fetchJson('https://downloads.php.net/~windows/releases/releases.json');

    const phpVersions = [];
    for (const [versionKey, versionData] of Object.entries(releasesData)) {
      if (!versionKey.match(/^\d+\.\d+$/)) continue;

      const buildTypes = Object.keys(versionData).filter(key =>
        key.includes('nts') && key.includes('x64')
      );

      if (buildTypes.length > 0 && versionData.version) {
        const buildType = buildTypes[0];
        const buildData = versionData[buildType];

        phpVersions.push({
          version: versionData.version,
          downloadUrl: `https://windows.php.net/downloads/releases/${buildData.zip.path}`
        });
      }
    }

    phpVersions.sort((a, b) => {
      const [aMajor, aMinor, aPatch] = a.version.split('.').map(Number);
      const [bMajor, bMinor, bPatch] = b.version.split('.').map(Number);
      return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
    });

    if (phpVersions.length === 0) return null;

    return { allVersions: phpVersions };
  },

  async phpmyadmin() {
    const releases = await fetchJson('https://api.github.com/repos/phpmyadmin/phpmyadmin/releases?per_page=50');
    const pmaVersions = releases
      .filter(release => !release.prerelease && !release.draft)
      .map(release => release.tag_name.replace(/^RELEASE_/, '').replace(/_/g, '.'))
      .filter(version => /^\d+\.\d+\.\d+$/.test(version))
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
        return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
      });

    if (pmaVersions.length === 0) return null;

    const latestVersion = pmaVersions[0];
    const downloadUrl = `https://files.phpmyadmin.net/phpMyAdmin/${latestVersion}/phpMyAdmin-${latestVersion}-all-languages.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return { version: latestVersion, downloadUrl };
  }
};

/**
 * Main function to check and update service versions
 */
async function updateVersions() {
  const versionsPath = path.join(__dirname, '../api/wemp/versions.json');

  console.log('Reading current versions...');
  let versions;
  try {
    versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
  } catch (error) {
    console.error('[ERROR] Failed to read versions.json:', error);
    throw error;
  }

  const services = Object.keys(serviceFetchers);
  let hasPatchUpdates = false;
  let hasMajorMinorUpdates = false;
  const updateSummary = { patch: [], majorMinor: [] };
  const majorMinorServices = new Set();

  console.log(`\nChecking ${services.length} services for updates...\n`);

  for (const service of services) {
    try {
      const currentVersion = versions[service]?.version || versions[service]?.versions?.[0]?.version;
      const currentVersions = versions[service]?.versions;

      if (service === 'php' && currentVersions) {
        const versionList = currentVersions.map(v => v.version).join(', ');
        console.log(`  Checking ${service}... (current: ${versionList})`);
      } else {
        console.log(`  Checking ${service}... (current: ${currentVersion || 'none'})`);
      }

      const latestInfo = await serviceFetchers[service]();

      if (latestInfo) {
        if (service === 'php' && latestInfo.allVersions) {
          // PHP: check all versions for updates
          const newVersions = latestInfo.allVersions.map(v => ({
            version: v.version,
            downloadUrl: v.downloadUrl
          }));

          const currentVersions = versions[service]?.versions || [];
          const currentVersionMap = new Map(currentVersions.map(v => [v.version, v]));
          const newVersionMap = new Map(newVersions.map(v => [v.version, v]));

          // Check for any changes in versions
          let hasChanges = false;
          const changedVersions = [];

          // Check if any new versions were added
          for (const newV of newVersions) {
            if (!currentVersionMap.has(newV.version)) {
              hasChanges = true;
              changedVersions.push(`+${newV.version}`);
            }
          }

          // Check if any versions were removed
          for (const currentV of currentVersions) {
            if (!newVersionMap.has(currentV.version)) {
              hasChanges = true;
              changedVersions.push(`-${currentV.version}`);
            }
          }

          if (hasChanges) {
            console.log(`    [UPDATE] Changes: ${changedVersions.join(', ')}`);
            hasPatchUpdates = true;
            updateSummary.patch.push({
              service,
              from: currentVersions[0]?.version || 'none',
              to: newVersions[0].version,
              changes: changedVersions
            });
          } else {
            console.log(`    [UP-TO-DATE]`);
          }

          versions[service] = { versions: newVersions };
        } else {
          // Single-version services
          const newVersion = latestInfo.version;
          const comparison = compareVersions(newVersion, currentVersion);

          if (comparison.isNewer) {
            console.log(`    [${comparison.updateType.toUpperCase()}] ${currentVersion || 'none'} -> ${newVersion}`);

            versions[service] = {
              version: newVersion,
              downloadUrl: latestInfo.downloadUrl
            };

            // Patch updates auto-merge, major/minor need PR
            if (comparison.updateType === 'patch') {
              hasPatchUpdates = true;
              updateSummary.patch.push({ service, from: currentVersion || 'none', to: newVersion });
            } else {
              hasMajorMinorUpdates = true;
              majorMinorServices.add(service);
              updateSummary.majorMinor.push({
                service,
                from: currentVersion || 'none',
                to: newVersion,
                type: comparison.updateType
              });
            }
          } else {
            console.log(`    [UP-TO-DATE]`);
          }
        }
      }
    } catch (error) {
      console.error(`    [ERROR] ${error.message}`);
    }
  }

  console.log('\nUpdate Summary:\n');

  if (hasPatchUpdates || hasMajorMinorUpdates) {
    console.log(`  Patch updates: ${updateSummary.patch.length > 0 ? updateSummary.patch.map(u => u.service).join(', ') : 'none'}`);
    console.log(`  Major/Minor updates: ${updateSummary.majorMinor.length > 0 ? updateSummary.majorMinor.map(u => u.service).join(', ') : 'none'}\n`);

    fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n');
    console.log('Updated versions.json successfully');

    if (process.env.GITHUB_ACTIONS && process.env.GITHUB_OUTPUT) {
      const majorMinorServicesList = JSON.stringify(Array.from(majorMinorServices));
      const outputs = [
        `has_patch_updates=${hasPatchUpdates}`,
        `has_major_minor_updates=${hasMajorMinorUpdates}`,
        `update_summary=${JSON.stringify(updateSummary).replace(/\n/g, '\\n')}`,
        `major_minor_services=${majorMinorServicesList}`
      ];
      fs.appendFileSync(process.env.GITHUB_OUTPUT, outputs.join('\n') + '\n');
    }
  } else {
    console.log('  All services are up to date\n');
    console.log('No updates needed');

    if (process.env.GITHUB_ACTIONS && process.env.GITHUB_OUTPUT) {
      const outputContent = 'has_patch_updates=false\nhas_major_minor_updates=false\nmajor_minor_services=[]\n';
      fs.appendFileSync(process.env.GITHUB_OUTPUT, outputContent);
    }
  }
}

// Run the updater
updateVersions()
  .catch(error => {
    console.error('[ERROR] Update failed:', error);
    process.exit(1);
  });
