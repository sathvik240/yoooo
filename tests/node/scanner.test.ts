import { describe, it, expect } from 'vitest'
import { scanText, type FindingKind } from '../../src/lib/scanner'

const kinds = (t: string) => scanText(t).map((f) => f.kind)
const texts = (t: string, k: FindingKind) => scanText(t).filter((f) => f.kind === k).map((f) => f.text)

describe('text scanner: positives', () => {
  it.each([
    ['email me at jamie.doe+pics@example.co.uk', 'email', 'jamie.doe+pics@example.co.uk'],
    ['contact: jamie [at] gmail [dot] com', 'email', 'jamie [at] gmail [dot] com'],
    ['call me 555-867-5309', 'phone', '555-867-5309'],
    ['text (415) 555 0199 anytime', 'phone', '(415) 555 0199'],
    ['UK mobile +44 7700 900123', 'phone', '+44 7700 900123'],
    ['ring 07700900123', 'phone', '07700900123'],
    ['party at 42 Elm Street tonight', 'address', '42 Elm Street'],
    ['221B Baker St, London', 'address', '221B Baker St'],
    ['1600 Pennsylvania Ave NW', 'address', '1600 Pennsylvania Ave'],
    ['send it to PO Box 1234', 'address', 'PO Box 1234'],
    ['we just moved, apt 4B now', 'address', 'apt 4B'],
    ['I live on Maple Grove Road', 'address', 'Maple Grove Road'],
    ['Springfield, IL 62704', 'postcode', 'IL 62704'],
    ['my zip is 90210', 'postcode', '90210'],
    ['London SW1A 1AA', 'postcode', 'SW1A 1AA'],
    ['Toronto M5V 3L9', 'postcode', 'M5V 3L9'],
    ['follow @jamie_doe for more', 'handle', '@jamie_doe'],
    ['my insta is jamiedoe.pics', 'handle', 'jamiedoe.pics'],
    ['add me on snap: jdoe99', 'handle', 'jdoe99'],
    ['tiktok.com/@jamiedoe', 'handle', 'tiktok.com/@jamiedoe'],
    ['just landed in Lisbon!!', 'realtime', 'just landed in'],
    ["I'm at Joe's Diner right now", 'realtime', "I'm at Joe's Diner right now"],
    ['come say hi, we are by the stage', 'realtime', 'come say hi'],
    ['on my way to the gym', 'realtime', 'on my way to'],
    ['home alone all weekend', 'away', 'home alone'],
    ['out of town until Sunday', 'away', 'out of town'],
    ['first day at Lincoln High School', 'school', 'Lincoln High School'],
    ['go University of Michigan', 'school', 'University of Michigan'],
    ['class of 2027 forever', 'school', 'class of 2027'],
    ['sophomore at Westfield', 'school', 'Westfield'],
    ['finally started working at Blue Bottle Coffee', 'work', 'Blue Bottle Coffee'],
    ['barista at Starbucks downtown', 'work', 'Starbucks'],
    ['Starting work at Blue Bottle Coffee on Monday', 'work', 'Blue Bottle Coffee'],
    ['just started at the Bank of America office', 'work', 'Bank of America'],
    ['the cafe across from Central Park', 'place', 'Central Park'],
    ['my neighbourhood is so pretty in spring', 'place', 'my neighbourhood'],
    ['we live in the Mission District now', 'place', 'Mission District'],
    ['my birthday is March 14', 'birthday', 'my birthday is March 14'],
    ['born on 14/03/2006', 'birthday', 'born on 14/03/2006'],
  ] as const)('%s → %s', (text, kind, match) => {
    expect(texts(text, kind)).toContain(match)
  })

  it('finds several things in one caption, in order', () => {
    const t = 'Just landed in Austin! DM @jamie_doe or email jamie@example.com. Staying at 12 Oak Lane, TX 78701'
    expect(kinds(t)).toEqual(['realtime', 'handle', 'email', 'address', 'postcode'])
  })

  it('reports exact positions for highlighting', () => {
    const t = 'mail jamie@example.com now'
    const [f] = scanText(t)
    expect(t.slice(f.start, f.end)).toBe('jamie@example.com')
  })
})

describe('text scanner: negatives (should stay quiet)', () => {
  it.each([
    'What a beautiful sunset tonight',
    'I have 3 dogs and a cat',
    'Scored 2024 points this season',
    'Meeting on 2024-06-01 at noon',
    'from 2019-2023 I learned a lot',
    'It costs $1,299.99 at most stores',
    'version 10.2.3 is out',
    'I walked 12 miles today',
    'the street was quiet',
    'loving this weather',
    'Top 10 tips for better sleep',
    'see you at 7:30',
    'the 5 best pizzas',
  ])('%s', (text) => {
    expect(scanText(text)).toEqual([])
  })

  it('an email is reported as an email, not a handle', () => {
    expect(kinds('write to jamie@example.com')).toEqual(['email'])
  })

  it('"right now" alone is only a possible finding', () => {
    const f = scanText('so tired right now')
    expect(f).toHaveLength(1)
    expect(f[0].confidence).toBe('possible')
  })
})
