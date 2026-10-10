/**
 * Caption / bio scanner. Local regexes and heuristics only; the text never
 * leaves the page. It is deliberately honest about being approximate: some
 * findings are marked "possible" rather than "likely".
 */

export type FindingKind = 'email' | 'phone' | 'address' | 'postcode' | 'handle' | 'realtime' | 'away' | 'school' | 'work' | 'place' | 'birthday'

export interface TextFinding {
  kind: FindingKind
  start: number
  end: number
  text: string
  confidence: 'likely' | 'possible'
}

export const KIND_INFO: Record<FindingKind, { label: string; why: string }> = {
  email: { label: 'Email address', why: 'Lets anyone contact you directly, and is often the key that links your accounts together.' },
  phone: { label: 'Phone number', why: 'Phone numbers can be looked up in people-search sites and used to reset accounts.' },
  address: { label: 'Street address', why: 'Says where to find you. Even a street name without the number narrows it down a lot.' },
  postcode: { label: 'ZIP / postcode', why: 'A postcode can cover just a few streets. Combined with other details it narrows things down fast.' },
  handle: { label: 'Other account', why: 'Links this post to another account, which may have your real name, face or friends on it.' },
  realtime: { label: 'Where you are right now', why: 'Tells people where to find you at this moment. Post after you’ve left instead.' },
  away: { label: 'Home may be empty', why: 'Announces that you (and maybe everyone) are away from home. Share trips after you’re back.' },
  school: { label: 'School', why: 'Schools are easy to find on a map and show where you spend your days. (Detected by pattern; may be approximate.)' },
  work: { label: 'Workplace', why: 'Your workplace says where you’ll be most weekdays. (Detected by pattern; may be approximate.)' },
  place: { label: 'Neighbourhood or landmark', why: 'Landmarks and neighbourhood names help narrow down where you live. (Approximate.)' },
  birthday: { label: 'Birthday', why: 'Date of birth is a common security question and a key piece for identity theft.' },
}

// --------------------------------------------------------------- patterns

const cap = `[A-Z0-9][\\w'’.&-]*` // a capitalised word (or number) in a proper name
const name = `(?:${cap}(?:\\s+(?:of|the|and|de|la|&)?\\s*${cap}){0,4})`

/** Both capitalised and lowercase spellings of each word. */
const anyCase = (words: string[]) => words.map((w) => `[${w[0].toUpperCase()}${w[0].toLowerCase()}]${w.slice(1)}`).join('|')

const STREET_SUFFIX = anyCase(['street', 'st', 'avenue', 'ave', 'road', 'rd', 'boulevard', 'blvd', 'lane', 'ln', 'drive', 'dr', 'court', 'ct', 'way', 'place', 'pl', 'terrace', 'ter', 'circle', 'cir', 'parkway', 'pkwy', 'highway', 'hwy', 'close', 'crescent', 'cres', 'square', 'sq', 'trail', 'trl', 'row', 'mews', 'grove', 'gardens'])

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC'

const PLATFORMS = 'insta(?:gram)?|ig|snap(?:chat)?|sc|tiktok|tt|twitter|x|threads|discord|twitch|telegram|tg|whatsapp|signal|venmo|cash\\s?app|paypal|onlyfans|of|youtube|yt|reddit|steam|psn|xbox|gamertag|kik|bluesky|bsky|mastodon|linkedin|github|facebook|fb|spotify|soundcloud|pinterest|tumblr|vsco|bereal|roblox|minecraft|ea|epic'

interface Rule {
  kind: FindingKind
  re: RegExp
  confidence: TextFinding['confidence']
  /** Optional capture group to highlight instead of the whole match. */
  group?: number
  /** Reject a candidate match. */
  reject?: (m: RegExpExecArray, text: string) => boolean
}

const RULES: Rule[] = [
  // Contact details
  { kind: 'email', confidence: 'likely', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { kind: 'email', confidence: 'possible', re: /\b[A-Za-z0-9._%+-]+\s*(?:\[at\]|\(at\)|\sat\s)\s*[A-Za-z0-9-]+\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*[A-Za-z]{2,}\b/gi },
  {
    kind: 'phone',
    confidence: 'likely',
    re: /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d{2,5}(?:[\s.-]\d{2,6}){1,4}(?![\w.]*\d)|(?<![\w.+])\+?\d{10,14}(?!\w)/g,
    reject: (m) => {
      const s = m[0].trim()
      const digits = s.replace(/\D/g, '')
      if (digits.length < 7 || digits.length > 15) return true
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s)) return true // dates
      if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(s)) return true // year ranges
      // Bare space-separated groups ("10 000 20 30") are usually not phones unless long.
      if (!/[-.()+]/.test(s) && /\s/.test(s) && digits.length < 10) return true
      return false
    },
  },

  // Addresses
  { kind: 'address', confidence: 'likely', re: new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:${cap}\\s+){0,4}(?:${STREET_SUFFIX})\\b\\.?(?:,?\\s*(?:[Aa]pt|[Aa]partment|[Uu]nit|[Ss]uite|#)\\.?\\s*[\\w-]+)?`, 'g') },
  { kind: 'address', confidence: 'likely', re: /\b(?:P\.?\s?O\.?\s+Box|[Pp]ost [Oo]ffice [Bb]ox)\s+\d+/g },
  { kind: 'address', confidence: 'likely', re: /\b(?:[Aa]pt|[Aa]partment|[Uu]nit|[Ss]uite|[Ff]lat)\.?\s*#?\s*\d+[A-Za-z]?\b/g },
  { kind: 'address', confidence: 'possible', group: 1, re: new RegExp(`\\b(?:live|living|lives|stay|staying|moved)\\s+(?:on|off)\\s+((?:${cap}\\s+){1,3}(?:${STREET_SUFFIX}))\\b`, 'gi') },

  // Postcodes
  { kind: 'postcode', confidence: 'likely', re: new RegExp(`\\b(?:${US_STATES}),?\\s+\\d{5}(?:-\\d{4})?\\b`, 'g') },
  { kind: 'postcode', confidence: 'likely', re: /\b\d{5}-\d{4}\b/g },
  { kind: 'postcode', confidence: 'likely', group: 1, re: /\b(?:zip|zip code|zipcode|postcode|postal code)\s*(?:is|:|#)?\s*([A-Z0-9]{3,4}\s?[A-Z0-9]{3}|\d{5})\b/gi },
  { kind: 'postcode', confidence: 'likely', re: /\b(?:GIR 0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/g }, // UK
  { kind: 'postcode', confidence: 'likely', re: /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d\b/g }, // Canada

  // Other accounts
  { kind: 'handle', confidence: 'likely', re: /(?<![\w.@])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?(?![\w@])/g, reject: (m, t) => /\.[a-z]{2,}$/i.test(m[0]) && t[m.index - 1] !== ' ' && m.index !== 0 },
  { kind: 'handle', confidence: 'likely', group: 1, re: new RegExp(`\\b(?:my|our|add me on|follow me on|find me on|hmu on|dm me on|message me on)\\s+(?:${PLATFORMS})(?:\\s+(?:is|handle|name|username|tag|@))?\\s*[:=\\-]?\\s*(@?[A-Za-z0-9_.#-]{3,32})`, 'gi'), reject: (m) => /^(is|on|at|and|the|for|me|it)$/i.test(m[1]) },
  { kind: 'handle', confidence: 'likely', re: /\b(?:https?:\/\/)?(?:www\.)?(?:instagram|tiktok|twitter|x|facebook|fb|snapchat|linkedin|github|youtube|twitch|reddit|threads|bsky|venmo|onlyfans|t)\.(?:com|net|app|me|social)\/(?:@|u\/|user\/|in\/|add\/)?[A-Za-z0-9_.-]{2,40}/gi },
  { kind: 'handle', confidence: 'likely', re: /\b[A-Za-z0-9_.]{2,32}#\d{4}\b/g }, // old Discord tags

  // Real-time location
  { kind: 'realtime', confidence: 'likely', re: /\b(?:just\s+(?:landed|arrived|got here|checked in|pulled up)(?:\s+(?:in|at|to))?|(?:currently|rn|right now)\s+(?:at|in)|(?:i'?m|im|we'?re|were)\s+(?:at|in)\s+(?:the\s+)?[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3}\s+(?:right now|rn|now|tonight|today)|live from|checking in at|come (?:say hi|find me|join us)|on my way to|omw to|heading to|sitting at|chilling at|here at)\b/gi },
  { kind: 'realtime', confidence: 'possible', re: /\b(?:right now|rn|atm|at the moment)\b/gi },
  { kind: 'away', confidence: 'likely', re: /\b(?:home alone|house to myself|out of town|away (?:for|until) (?:the|a|two|three|\d+)\s*\w*|on (?:vacation|holiday) (?:for|until)|(?:leaving|flying out) (?:tomorrow|tonight|today|on \w+day))\b/gi },

  // School / work / place (heuristic)
  { kind: 'school', confidence: 'possible', re: new RegExp(`\\b(?:${cap}\\s+){1,4}(?:High School|Middle School|Junior High|Elementary(?: School)?|Primary School|Secondary School|Academy|Prep|Preparatory School|Community College|College|University|Institute of Technology|School)\\b`, 'g') },
  { kind: 'school', confidence: 'possible', re: new RegExp(`\\bUniversity of (?:${cap}\\s?){1,3}`, 'g') },
  { kind: 'school', confidence: 'possible', re: /\bclass of '?(?:19|20)?\d{2}\b/gi },
  { kind: 'school', confidence: 'possible', group: 1, re: new RegExp(`\\b(?:freshman|sophomore|junior|senior|student|grade \\d+|year \\d+|teacher)\\s+at\\s+(${name})`, 'gi') },
  { kind: 'work', confidence: 'possible', group: 1, re: new RegExp(`\\b(?:work|works|working|worked|intern|interning|employed|job|shift|internship|started)\\s+(?:at|for|with)\\s+(?:the\\s+)?(${name})`, 'gi'), reject: (m) => /^(home|the|a|my|night|least|all|it|me|this|that|\d+)$/i.test(m[1].trim()) },
  { kind: 'work', confidence: 'possible', group: 1, re: new RegExp(`\\b(?:barista|cashier|nurse|teacher|engineer|manager|server|bartender|developer|designer|intern|doctor|receptionist|employee)\\s+at\\s+(?:the\\s+)?(${name})`, 'gi') },
  { kind: 'place', confidence: 'possible', group: 1, re: new RegExp(`\\b(?:near|next to|across from|across the street from|down the street from|around the corner from|opposite|behind|walking distance (?:from|to))\\s+(?:the\\s+|my\\s+)?(${name})`, 'g') },
  { kind: 'place', confidence: 'possible', re: /\b(?:my|our)\s+(?:neighbou?rhood|street|block|building|apartment|flat|house|road|estate|cul-de-sac|town)\b/gi },
  { kind: 'place', confidence: 'possible', group: 1, re: new RegExp(`\\b(?:live|living|lives|grew up|moved|from)\\s+(?:in|to)\\s+(?:the\\s+)?(${name})`, 'g') },
  { kind: 'place', confidence: 'possible', group: 1, re: new RegExp(`\\bin\\s+(?:the\\s+)?(${name}\\s+(?:neighbou?rhood|area|district|suburb|borough|village))`, 'g') },

  // Birthday
  { kind: 'birthday', confidence: 'likely', re: /\b(?:born on|my (?:birthday|bday|b-day) is|dob:?|date of birth:?)\s*(?:[A-Z][a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?(?:\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Z][a-z]+(?:\s+\d{4})?|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)/gi },
]

const PRIORITY: Record<FindingKind, number> = { email: 10, phone: 9, address: 9, postcode: 8, birthday: 8, handle: 7, away: 6, realtime: 6, school: 4, work: 4, place: 3 }

const NAME_KINDS = new Set<FindingKind>(['school', 'work', 'place'])
const CONNECTORS = new Set(['of', 'the', 'and', 'de', 'la', '&'])
const STOP_WORDS = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Today|Tonight|Tomorrow|January|February|March|April|May|June|July|August|September|October|November|December|I|I'm|We)$/

/** Keep the capitalised run of words: "Blue Bottle Coffee on Monday" -> "Blue Bottle Coffee". */
function properName(s: string): string {
  const words = s.split(/\s+/)
  const out: string[] = []
  for (const w of words) {
    if (STOP_WORDS.test(w)) break
    if (/^[A-Z0-9]/.test(w)) out.push(w)
    else if (CONNECTORS.has(w) && out.length) out.push(w)
    else break
  }
  while (out.length && CONNECTORS.has(out[out.length - 1])) out.pop()
  return out.join(' ')
}

export function scanText(text: string): TextFinding[] {
  const found: TextFinding[] = []
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(text))) {
      if (m[0].length === 0) {
        rule.re.lastIndex++
        continue
      }
      if (rule.reject?.(m, text)) continue
      let start = m.index
      let str = m[0]
      if (rule.group && m[rule.group]) {
        str = m[rule.group]
        start = m.index + m[0].lastIndexOf(str)
        if (NAME_KINDS.has(rule.kind)) {
          // Proper names: case-insensitive keywords can drag in lowercase
          // words ("Starbucks downtown"); keep only the capitalised part.
          str = properName(str)
          if (!/^[A-Z0-9]/.test(str)) continue
        }
      }
      // Trim trailing punctuation that regexes greedily include.
      const trimmed = str.replace(/[\s.,;:!?)'’"]+$/, '')
      if (!trimmed) continue
      found.push({ kind: rule.kind, start, end: start + trimmed.length, text: trimmed, confidence: rule.confidence })
    }
  }
  return resolveOverlaps(found)
}

/** Keep the most specific finding where several overlap. */
function resolveOverlaps(list: TextFinding[]): TextFinding[] {
  const score = (f: TextFinding) => PRIORITY[f.kind] * 1000 + (f.confidence === 'likely' ? 500 : 0) + (f.end - f.start)
  const sorted = [...list].sort((a, b) => score(b) - score(a))
  const kept: TextFinding[] = []
  for (const f of sorted) {
    if (kept.some((k) => f.start < k.end && k.start < f.end)) continue
    kept.push(f)
  }
  return kept.sort((a, b) => a.start - b.start)
}
