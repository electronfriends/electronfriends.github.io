const formatFileSize = bytes => `${Math.round(bytes / (1024 * 1024))} MB`;

const closeModal = (modal) => {
  modal.style.display = 'none';
  document.body.classList.remove('modal-open');
};

const setupModal = (modal, downloadButton) => {
  downloadButton.addEventListener('click', (e) => {
    e.preventDefault();
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
  });

  modal.addEventListener('click', (e) => e.target === modal && closeModal(modal));
  document.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
  document.querySelector('.modal-button').addEventListener('click', () => {
    closeModal(modal);
    window.location = downloadButton.href;
  });
};

const updateVersions = async (releaseData) => {
  try {
    const configResponse = await fetch(`https://api.github.com/repos/electronfriends/wemp/contents/src/config.js?ref=${releaseData.tag_name}`);
    const configData = await configResponse.json();
    const configText = atob(configData.content);
    const versionMatches = [...configText.matchAll(/name:\s*'([^']+)',\s*version:\s*'([^']+)'/g)];

    versionMatches.forEach(([, name, version]) => {
      const versionSpan = document.querySelector(`[data-service="${name}"]`);
      if (versionSpan) {
        versionSpan.textContent = version;
      }
    });
  } catch (error) {
    console.error('Failed to fetch or parse config.js:', error);
    document.querySelectorAll('.version[data-service]').forEach(span => {
      span.textContent = 'unavailable';
    });
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  const downloadButton = document.querySelector('.download-button');

  try {
    const releasesResponse = await fetch('https://api.github.com/repos/electronfriends/wemp/releases/latest');

    if (!releasesResponse.ok) {
      throw new Error(`GitHub API responded with status: ${releasesResponse.status}`);
    }

    const releaseData = await releasesResponse.json();

    if (releaseData.assets?.length > 0) {
      const exeAsset = releaseData.assets.find(asset => asset.name.endsWith('.exe'));
      if (exeAsset) {
        downloadButton.href = exeAsset.browser_download_url;
        document.querySelector('.download-size').textContent = formatFileSize(exeAsset.size);
      }

      const versionTag = document.querySelector('.version-tag');
      versionTag.textContent = releaseData.tag_name;
      versionTag.closest('.version-info').href = releaseData.html_url;

      await updateVersions(releaseData);
    } else {
      throw new Error('No release assets found');
    }
  } catch (error) {
    console.error('Failed to fetch release data:', error);
    downloadButton.href = 'https://github.com/electronfriends/wemp/releases/latest';
    document.querySelector('.download-size').textContent = 'Visit GitHub';
    document.querySelectorAll('.version[data-service]').forEach(span => {
      span.textContent = 'unavailable';
    });
  }

  setupModal(document.getElementById('smartscreen-modal'), downloadButton);
});
