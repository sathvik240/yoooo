import { watchNetwork } from '../lib/netwatch'

/** Shared header for both pages. `home` is the path back to the cleaner. */
export function mastheadHtml(page: 'home' | 'beyond'): string {
  const home = page === 'home' ? '' : './'
  return /* html */ `
  <header class="masthead">
    <a class="masthead-mark" href="./" aria-label="Unpin home">unpin</a>
    <nav class="masthead-nav" aria-label="Sections">
      <a href="${home}#clean">Clean<span class="long"> files</span></a>
      <a href="${home}#caption"><span class="long">Check a </span>caption</a>
      <a href="${home}#limits"><span class="long">What it can’t do</span><span class="short">Limits</span></a>
      <a href="./beyond.html"${page === 'beyond' ? ' aria-current="page"' : ''}>Beyond<span class="long"> files</span></a>
    </nav>
    <p class="netbadge" title="Counted by your browser since this page opened"><span class="netdot" aria-hidden="true"></span><span class="netcount">0</span> outside requests</p>
  </header>`
}

export function startNetBadge(): void {
  watchNetwork((n) => {
    const c = document.querySelector('.netcount')
    if (c) c.textContent = String(n)
    document.querySelector('.netbadge')?.classList.toggle('warn', n > 0)
  })
}

export const footerHtml = /* html */ `
  <footer class="footer">
    <p>Unpin runs entirely in your browser. No uploads, no analytics, no cookies, no third-party anything. The page is locked down so it can’t talk to other servers even by accident.</p>
  </footer>`
