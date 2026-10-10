import './styles/fonts.css'
import './styles/base.css'
import './styles/app.css'
import './styles/beyond.css'
import { mastheadHtml, footerHtml, startNetBadge } from './ui/masthead'
import { decorativeContours } from './ui/contour'

interface Section {
  id: string
  title: string
  lede: string
  steps: string[]
  note?: string
}

const SECTIONS: Section[] = [
  {
    id: 'split',
    title: 'Keep the parts of your life apart',
    lede: 'Most doxxing isn’t one big leak. It’s small details from different places joined together, usually through a shared username, email or photo.',
    steps: [
      'Use a different username for anonymous or hobby accounts than for accounts tied to your real name.',
      'Use separate email addresses too. Many email providers offer free aliases or “hide my email” addresses that forward to your inbox.',
      'Don’t reuse a profile photo across accounts you want kept apart. Reverse image search connects them in seconds.',
      'Search your own usernames and email in a private window now and then, to see what a stranger would find.',
    ],
  },
  {
    id: 'location',
    title: 'Turn off location where it isn’t needed',
    lede: 'Your phone can stop writing GPS into photos in the first place. That’s the most reliable fix there is.',
    steps: [
      'iPhone: Settings → Privacy & Security → Location Services → Camera → Never. When sharing, tap “Options” at the top of the share sheet and switch off Location.',
      'Android: open the Camera app’s settings and turn off “Save location” or “Location tags” (the name varies by phone).',
      'Review which apps have location access. Most only need it “while using”, and many don’t need “precise” location at all.',
      'Check that your social apps aren’t adding a location to posts or stories by default.',
    ],
  },
  {
    id: 'fitness',
    title: 'Fitness apps: don’t start at your front door',
    lede: 'A run or ride that begins and ends at the same spot every morning is a map to your home.',
    steps: [
      'Set a privacy zone or “hidden start/end” around your home and work in the app’s privacy settings.',
      'Make activities visible to followers only, or private by default.',
      'Start and stop recording a few streets away from home.',
      'Turn off public segment leaderboards and heatmap contributions if you don’t need them.',
    ],
  },
  {
    id: 'brokers',
    title: 'Get yourself off people-search sites',
    lede: 'Data brokers collect addresses, phone numbers and relatives from public records and sell them. You can ask most of them to remove you.',
    steps: [
      'Search your full name plus your city. Note which people-search sites list you.',
      'Each site has an opt-out page, usually linked in its footer or privacy policy. Expect to confirm by email.',
      'Listings tend to come back. Set a reminder to check again every few months.',
      'Depending on where you live, privacy laws (such as GDPR in the UK and EU, or state laws in the US) may give you a right to have your data deleted. Some places have a single deletion request for all registered brokers.',
    ],
    note: 'Paid removal services exist and can save time, but check what they actually cover. None can remove everything.',
  },
  {
    id: 'whois',
    title: 'If you own a domain name, hide your WHOIS record',
    lede: 'Registering a website can publish your name, address and phone number in a public directory.',
    steps: [
      'Turn on WHOIS privacy (sometimes called “domain privacy” or “redaction”) in your registrar’s settings. Many include it free.',
      'Old records may still exist in history services. Privacy from now on still helps.',
      'For a business, consider a registered agent or a mailing address instead of your home.',
    ],
  },
  {
    id: 'people',
    title: 'Talk to the people who post you',
    lede: 'Friends and family can share your location without meaning to.',
    steps: [
      'Ask friends not to tag your location or post where you are in real time.',
      'Turn on tag review so tags need your approval before they appear on your profile.',
      'Be careful with group photos taken at home, school or work. Backgrounds travel with them.',
    ],
  },
  {
    id: 'accounts',
    title: 'Lock the doors on your accounts',
    lede: 'Doxxing and account takeovers often go together. A few settings make both much harder.',
    steps: [
      'Use a password manager and a different password for every account.',
      'Turn on two-step verification, preferably with an authenticator app or security key rather than SMS.',
      'Remove your phone number from accounts that don’t need it; it’s often the key used to find you elsewhere.',
      'Check privacy settings on old accounts, or delete the ones you don’t use.',
    ],
  },
  {
    id: 'already',
    title: 'If it’s already happening',
    lede: 'Being doxxed is frightening. You don’t have to deal with it alone.',
    steps: [
      'Save evidence first: screenshots with the address bar, dates and usernames visible.',
      'Report the posts to the platform. Most have specific rules against sharing private information.',
      'Lock down your accounts (above) and tell the people close to you, so they’re not caught off guard.',
      'If you feel unsafe, contact local law enforcement or a support organisation for online harassment in your country.',
    ],
  },
]

document.querySelector('#app')!.innerHTML = /* html */ `
  ${mastheadHtml('beyond')}
  <main id="main" tabindex="-1" class="guide">
    <header class="guide-hero">
      <div class="guide-bg" aria-hidden="true"></div>
      <p class="eyebrow">04 — Beyond files</p>
      <h1 class="guide-title">The rest of the map.</h1>
      <p class="section-lede">Clean files are one layer. These habits cover the others. None of them are perfect and none need to be: each one makes you a little harder to find.</p>
    </header>
    <div class="guide-body">
      <nav class="guide-toc" aria-label="On this page">
        <p class="eyebrow">On this page</p>
        <ol>${SECTIONS.map((s) => `<li><a href="#${s.id}">${s.title}</a></li>`).join('')}</ol>
      </nav>
      <div class="guide-sections">
        ${SECTIONS.map((s, i) => /* html */ `
        <section class="guide-section" id="${s.id}" aria-labelledby="${s.id}-title">
          <p class="guide-no">${String(i + 1).padStart(2, '0')}</p>
          <h2 id="${s.id}-title">${s.title}</h2>
          <p class="guide-lede">${s.lede}</p>
          <ul class="guide-steps">${s.steps.map((st) => `<li>${st}</li>`).join('')}</ul>
          ${s.note ? `<p class="note">${s.note}</p>` : ''}
        </section>`).join('')}
        <section class="guide-section guide-back">
          <h2>Back to your files</h2>
          <p class="guide-lede">Got a photo or document to share? Unpin it first.</p>
          <p><a class="btn btn-primary" href="./#clean">Clean a file</a></p>
        </section>
      </div>
    </div>
  </main>
  ${footerHtml}
`

document.querySelector('.guide-bg')!.append(decorativeContours(73985428, 10))
startNetBadge()
