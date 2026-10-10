import type { Findings } from '../lib/handlers'
import { formatCoord } from '../lib/fields'

/**
 * One plain sentence that reads the metadata back like a stranger would:
 * "Taken on a Pixelphone 9 Pro, on 1 June 2024 at 8:14 am, by Jamie Doe."
 */
export function summarize(f: Findings, family: string): string | null {
  const get = (...labels: string[]) => f.fields.find((x) => labels.includes(x.label))?.value
  const parts: string[] = []
  if (family === 'image' || family === 'video') {
    const model = get('Phone / camera model')
    const make = get('Phone / camera maker')
    const when = get('Taken', 'Created')
    const who = get('Camera owner', 'Artist', 'Creator', 'By-line', 'Author')
    const city = get('City')
    if (model) parts.push(`on a ${model.toLowerCase().startsWith((make ?? '').toLowerCase()) || !make ? model : `${make} ${model}`}`)
    if (when) parts.push(`on ${humanDate(when)}`)
    if (f.image?.gps) parts.push(`at ${formatCoord(f.image.gps.latitude, f.image.gps.longitude)}`)
    else if (city) parts.push(`in ${city}`)
    if (who) parts.push(`by ${who}`)
    if (!parts.length) return null
    return `${family === 'video' ? 'Filmed' : 'Taken'} ${parts.join(', ')}.`
  }
  const author = get('Author', 'Creator')
  const last = get('Last edited by')
  const company = get('Company')
  const when = get('Created')
  if (author) parts.push(`written by ${author}`)
  if (last && last !== author) parts.push(`last edited by ${last}`)
  if (company) parts.push(`at ${company}`)
  if (when) parts.push(`on ${humanDate(when)}`)
  if (!parts.length) return null
  const s = parts.join(', ')
  return s[0].toUpperCase() + s.slice(1) + '.'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2024-06-01 08:14:22" -> "1 June 2024 at 8:14 am". Unparseable input is returned as-is. */
export function humanDate(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (!m) return s
  const [, y, mo, d, hh, mm] = m
  let out = `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`
  if (hh) {
    const hr = Number(hh)
    out += ` at ${hr % 12 || 12}:${mm} ${hr < 12 ? 'am' : 'pm'}`
  }
  return out
}
