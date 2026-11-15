// Download buttons: find the newest release on GitHub and point each button at the right file.
// If anything fails, the buttons link to the releases page, so a visitor is never stuck.
(function () {
  const { owner, repo } = window.IB
  const repoUrl = `https://github.com/${owner}/${repo}`
  const releasesUrl = `${repoUrl}/releases`
  const $$ = (selector) => [...document.querySelectorAll(selector)]

  $$('[data-repo]').forEach((a) => (a.href = repoUrl))
  $$('[data-repo-releases]').forEach((a) => (a.href = releasesUrl))
  $$('[data-repo-issues]').forEach((a) => (a.href = `${repoUrl}/issues`))
  $$('[data-repo-license]').forEach((a) => (a.href = `${repoUrl}/blob/main/LICENSE`))

  // Which computer is this?
  const ua = navigator.userAgent
  const phone = /iPhone|iPad|Android/i.test(ua)
  const mac = !phone && /Macintosh|Mac OS X/i.test(ua)
  const win = !phone && /Windows/i.test(ua)
  const os = mac ? 'mac' : win ? 'win' : null
  const heroButton = document.getElementById('hero-download')
  const heroOther = document.getElementById('hero-other')
  if (os === 'mac') heroButton.textContent = 'Download for Mac'
  else if (os === 'win') heroButton.textContent = 'Download for Windows'
  else heroButton.textContent = 'Download'
  document.getElementById(os === 'win' ? 'panel-win' : 'panel-mac')?.classList.toggle('is-yours', os !== null)

  const formatSize = (bytes) => `${Math.round(bytes / 1048576)} MB`
  const assetKinds = {
    'mac-arm64': /mac-arm64\.dmg$/i,
    'mac-x64': /mac-x64\.dmg$/i,
    'win-x64': /win-x64\.exe$/i
  }

  function fallback(message) {
    document.getElementById('release-line').textContent = message
    $$('[data-asset]').forEach((a) => (a.href = releasesUrl))
    heroButton.href = releasesUrl
  }

  async function guessAppleSilicon() {
    // Only Chromium browsers can tell the chip. Others get Apple silicon first, and the Intel link is next to it.
    try {
      const info = await navigator.userAgentData?.getHighEntropyValues?.(['architecture'])
      if (info?.architecture) return info.architecture !== 'x86'
    } catch { /* not available */ }
    return true
  }

  fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then(async (release) => {
      const found = {}
      for (const [kind, pattern] of Object.entries(assetKinds)) {
        const asset = release.assets.find((a) => pattern.test(a.name))
        if (asset) found[kind] = asset
      }
      $$('[data-asset]').forEach((a) => {
        const asset = found[a.dataset.asset]
        if (asset) {
          a.href = asset.browser_download_url
          a.querySelector('.size').textContent = formatSize(asset.size)
        } else {
          a.href = releasesUrl
        }
      })
      const date = new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      document.getElementById('release-line').textContent = `Version ${release.tag_name.replace(/^v/, '')}, released ${date}.`
      // A release that is not notarized needs one extra step on the Mac. The release notes say so.
      if (/not notarized|unsigned/i.test(release.body || '')) $$('[data-unsigned]').forEach((n) => (n.hidden = false))

      // The big button goes straight to the right file.
      if (os === 'mac') {
        const silicon = await guessAppleSilicon()
        const pick = (silicon ? found['mac-arm64'] : found['mac-x64']) || found['mac-arm64'] || found['mac-x64']
        if (pick) heroButton.href = pick.browser_download_url
        heroOther.textContent = silicon ? 'Intel Mac, or Windows' : 'Apple silicon, or Windows'
      } else if (os === 'win' && found['win-x64']) {
        heroButton.href = found['win-x64'].browser_download_url
        heroOther.textContent = 'Mac downloads'
      }
    })
    .catch((error) => {
      fallback(String(error.message) === '404' ? 'The first version is being prepared. Check back soon.' : 'Find the newest version on the releases page.')
    })

  // Show things as they scroll into view.
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); seen.unobserve(entry.target) }
    }, { threshold: 0.15 })
    $$('.reveal').forEach((el) => seen.observe(el))
  } else {
    $$('.reveal').forEach((el) => el.classList.add('in'))
  }
})()
