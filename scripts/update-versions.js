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
 * Find available version updates for a service
 */
function findAvailableUpdates(availableVersions, currentVersion) {
  if (!currentVersion) {
    return { latest: availableVersions[0] };
  }

  const parseVersion = (v) => v.split('.').map(Number);
  const [curMajor, curMinor] = parseVersion(currentVersion);

  // Find the latest patch version within the same major.minor
  const patchUpdates = availableVersions.filter(version => {
    const [major, minor] = parseVersion(version);
    return major === curMajor && minor === curMinor;
  });

  const latestPatch = patchUpdates.length > 0 && patchUpdates[0] !== currentVersion ? patchUpdates[0] : null;
  const latestOverall = availableVersions[0] !== currentVersion ? availableVersions[0] : null;

  // Return patch and latest versions
  return {
    patch: latestPatch,
    latest: latestOverall
  };
}

/**
 * Service version fetchers for each supported service
 */
const serviceFetchers = {
  async nginx(currentVersion) {
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

    const updates = findAvailableUpdates(nginxVersions, currentVersion);

    const bestVersion = updates.patch || updates.latest;
    if (!bestVersion) return null;

    const downloadUrl = `https://nginx.org/download/nginx-${bestVersion}.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return {
      version: bestVersion,
      downloadUrl,
      updates
    };
  },

  async mariadb(currentVersion) {
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

    const updates = findAvailableUpdates(mariadbVersions, currentVersion);

    const bestVersion = updates.patch || updates.latest;
    if (!bestVersion) return null;

    const downloadUrl = `https://archive.mariadb.org/mariadb-${bestVersion}/winx64-packages/mariadb-${bestVersion}-winx64.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return {
      version: bestVersion,
      downloadUrl,
      updates
    };
  },

  async php(currentVersion) {
    const tags = await fetchJson('https://api.github.com/repos/php/php-src/tags?per_page=100');
    const phpVersions = tags
      .filter(tag => /^php-\d+\.\d+\.\d+$/.test(tag.name))
      .map(tag => tag.name.replace('php-', ''))
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
        return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
      });

    if (phpVersions.length === 0) return null;

    const updates = findAvailableUpdates(phpVersions, currentVersion);

    const bestVersion = updates.patch || updates.latest;
    if (!bestVersion) return null;

    // Get download info from PHP Windows releases API
    const releasesData = await fetchJson('https://windows.php.net/downloads/releases/releases.json');
    const [major, minor] = bestVersion.split('.');
    const versionKey = `${major}.${minor}`;

    if (!releasesData[versionKey]) {
      throw new Error(`No Windows release data found for PHP ${bestVersion}`);
    }

    const versionData = releasesData[versionKey];
    if (versionData.version !== bestVersion) {
      throw new Error(`Version mismatch: expected ${bestVersion}, found ${versionData.version}`);
    }

    // Look for NTS x64 build (preferred for most use cases)
    const buildTypes = Object.keys(versionData).filter(key => key.includes('nts') && key.includes('x64'));

    if (buildTypes.length === 0) {
      throw new Error(`No suitable NTS x64 build found for PHP ${bestVersion}`);
    }

    const buildType = buildTypes[0]; // Use first available NTS x64 build
    const buildData = versionData[buildType];
    const downloadUrl = `https://windows.php.net/downloads/releases/${buildData.zip.path}`;

    return {
      version: bestVersion,
      downloadUrl,
      updates
    };
  },

  async phpmyadmin(currentVersion) {
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

    const updates = findAvailableUpdates(pmaVersions, currentVersion);

    const bestVersion = updates.patch || updates.latest;
    if (!bestVersion) return null;

    const downloadUrl = `https://files.phpmyadmin.net/phpMyAdmin/${bestVersion}/phpMyAdmin-${bestVersion}-all-languages.zip`;

    if (!(await isValidZip(downloadUrl))) {
      throw new Error('Invalid download URL');
    }

    return {
      version: bestVersion,
      downloadUrl,
      updates
    };
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

  let hasPatchUpdates = false;
  let hasMajorMinorUpdates = false;
  const services = Object.keys(serviceFetchers);
  const updateSummary = { patch: [], majorMinor: [] };
  const majorMinorServices = new Set();

  console.log(`\nChecking ${services.length} services for updates...\n`);

  // Process services sequentially to ensure clean output
  const results = [];
  for (const service of services) {
    try {
      const currentVersion = versions[service]?.version;
      console.log(`  Checking ${service}... (current: ${currentVersion || 'not installed'})`);
      const latestInfo = await serviceFetchers[service](currentVersion);

      if (latestInfo?.updates) {
        const currentVersion = versions[service]?.version || 'none';
        const { patch, latest } = latestInfo.updates;

        // Check for patch update
        if (patch && patch !== currentVersion) {
          const patchComparison = compareVersions(patch, currentVersion);
          if (patchComparison.isNewer) {
            console.log(`    [PATCH] ${currentVersion} -> ${patch}`);
            hasPatchUpdates = true;
            updateSummary.patch.push({ service, from: currentVersion, to: patch });
          }
        }

        // Check for major/minor update (if different from patch)
        if (latest && latest !== currentVersion && latest !== patch) {
          const latestComparison = compareVersions(latest, currentVersion);
          if (latestComparison.isNewer && latestComparison.updateType !== 'patch') {
            console.log(`    [${latestComparison.updateType.toUpperCase()}] ${currentVersion} -> ${latest} (available)`);
            hasMajorMinorUpdates = true;
            majorMinorServices.add(service);
            updateSummary.majorMinor.push({
              service,
              from: currentVersion,
              to: latest,
              type: latestComparison.updateType
            });
          }
        }

        // Update versions.json with selected version
        const selectedVersion = patch || latest;
        if (selectedVersion && selectedVersion !== currentVersion) {
          versions[service] = {
            version: selectedVersion,
            downloadUrl: latestInfo.downloadUrl
          };
        } else {
          console.log(`    [UP-TO-DATE]`);
        }
      }

      results.push({ service, success: true });
    } catch (error) {
      console.error(`    [ERROR] ${error.message}`);
      results.push({ service, success: false, error: error.message });
    }
  }

  console.log('\nUpdate Summary:\n');

  // Report failed services
  const failedServices = results
    .filter(result => !result.success)
    .map(result => result.service);

  if (failedServices.length > 0) {
    console.warn(`  Failed services: ${failedServices.join(', ')}\n`);
  }

  // Write updated versions file
  if (hasPatchUpdates || hasMajorMinorUpdates) {
    console.log(`  Patch updates: ${updateSummary.patch.length > 0 ? updateSummary.patch.map(u => u.service).join(', ') : 'none'}`);
    console.log(`  Major/Minor updates: ${updateSummary.majorMinor.length > 0 ? updateSummary.majorMinor.map(u => u.service).join(', ') : 'none'}`);
    console.log('');

    fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n');
    console.log('Updated versions.json successfully');

    // Export data for GitHub Actions
    if (process.env.GITHUB_ACTIONS && process.env.GITHUB_OUTPUT) {
      const majorMinorServicesList = JSON.stringify(Array.from(majorMinorServices));
      const outputs = [
        `has_patch_updates=${hasPatchUpdates}`,
        `has_major_minor_updates=${hasMajorMinorUpdates}`,
        `update_summary=${JSON.stringify(updateSummary).replace(/\n/g, '\\n')}`,
        `major_minor_services=${majorMinorServicesList}`
      ];

      console.log('Setting GitHub Actions outputs:');
      console.log(`  has_patch_updates=${hasPatchUpdates}`);
      console.log(`  has_major_minor_updates=${hasMajorMinorUpdates}`);
      console.log(`  major_minor_services=${majorMinorServicesList}`);

      const outputContent = outputs.join('\n') + '\n';
      fs.appendFileSync(process.env.GITHUB_OUTPUT, outputContent);
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
