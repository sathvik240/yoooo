import { h } from './dom'

export interface CheckItem {
  id: string
  title: string
  detail: string
  /** Offer the "go back and redact" shortcut for this item. */
  redact?: boolean
}

export const PHOTO_CHECKS: CheckItem[] = [
  { id: 'map', title: 'Nothing that could be matched to a map', detail: 'Street signs, house numbers, licence plates, a distinctive building, or the view from a window. People really do find places from these.', redact: true },
  { id: 'reflect', title: 'No revealing reflections', detail: 'Glasses, mirrors, windows and screens can show you, your room, or what\u2019s outside. Zoom in to check.', redact: true },
  { id: 'paper', title: 'No mail, packages, badges or documents', detail: 'Names and addresses on labels, name tags and ID badges stay readable even when they look tiny.', redact: true },
  { id: 'people', title: 'Everyone in it is okay with this', detail: 'Other people\u2019s faces are theirs to share. Blur anyone who didn\u2019t say yes, especially kids.', redact: true },
  { id: 'later', title: 'Not posting \u201cI\u2019m here right now\u201d', detail: 'Live posts tell people where to find you. Posting after you\u2019ve left is just as good, and much safer.' },
  { id: 'routine', title: 'The background doesn\u2019t point to home, school or work', detail: 'Uniforms, logos, your front door or your usual café all show where you spend your days.', redact: true },
  { id: 'reuse', title: 'Not reusing a photo or username that links your accounts', detail: 'A reverse image search can connect a reused profile photo or username to your other accounts.' },
]

export const SCREENSHOT_CHECKS: CheckItem[] = [
  { id: 'ss-user', title: 'No usernames or real names', detail: 'Profile names in chats, account menus and comment threads.', redact: true },
  { id: 'ss-tabs', title: 'No revealing browser tabs or bookmarks', detail: 'Open tabs and the bookmarks bar show what you\u2019re into and where you log in.', redact: true },
  { id: 'ss-notif', title: 'No notifications', detail: 'Message previews show names, numbers and snippets of private conversations.', redact: true },
  { id: 'ss-bar', title: 'Taskbar, dock and status bar are safe', detail: 'Clock, carrier, Wi\u2011Fi name, battery and open apps add up to a fingerprint.', redact: true },
  { id: 'ss-path', title: 'No file paths with your name', detail: 'Paths like C:\\Users\\JamieDoe or /Users/jamie reveal your real name.', redact: true },
  { id: 'ss-acct', title: 'No email or account details', detail: 'Email addresses, account numbers, order numbers and QR codes.', redact: true },
]

export const DOC_CHECKS: CheckItem[] = [
  { id: 'doc-text', title: 'The visible text is okay to share', detail: 'Names, addresses, phone numbers and signatures in the body, headers and footers stay as they are.' },
  { id: 'doc-changes', title: 'Tracked changes accepted or rejected', detail: 'Deleted text in tracked changes is still in the file. Accept or reject everything first.' },
  { id: 'doc-hidden', title: 'No hidden rows, sheets, slides or speaker notes', detail: 'Hidden content travels with the file and is one click away for the reader.' },
  { id: 'doc-images', title: 'Images and screenshots inside are safe', detail: 'Check pictures in the document for the same things you\u2019d check in a photo.' },
  { id: 'doc-redact', title: 'Black boxes are real redactions', detail: 'A black rectangle drawn over text in a PDF often leaves the text underneath selectable. Use a real redaction tool.' },
]

/**
 * "Check before you post": the risks metadata stripping can't fix. Purely
 * local; ticks are just for the person using it.
 */
export function checklist(items: CheckItem[], opts: { title: string; intro: string; onRedact?: () => void; idPrefix: string }): HTMLElement {
  const progress = h('span.check-progress')
  const update = () => {
    const done = list.querySelectorAll('input:checked').length
    progress.textContent = `${done} of ${items.length}`
    el.classList.toggle('all-done', done === items.length)
  }
  const list = h('ul.check-list', ...items.map((it) => {
    const id = `${opts.idPrefix}-${it.id}`
    return h('li.check-item',
      h('input.check-box', { type: 'checkbox', id, onchange: update }),
      h('label.check-label', { for: id }, h('span.check-title', it.title), h('span.check-detail', it.detail)),
      it.redact && opts.onRedact ? h('button.check-redact', { type: 'button', onclick: opts.onRedact, 'aria-label': `Go back and redact: ${it.title}` }, 'Redact') : null)
  }))
  const el = h('details.checklist', { open: true },
    h('summary.check-summary', h('span.check-heading', opts.title), progress),
    h('p.check-intro', opts.intro),
    list,
    h('p.check-done', 'Looks good. Thanks for taking a second look.'))
  update()
  return el
}
