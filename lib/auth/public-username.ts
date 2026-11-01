import { nicknameSchema } from '@/lib/validation'

const ADJECTIVES = [
  'Curious', 'Silent', 'Bright', 'Calm', 'Swift', 'Gentle', 'Bold', 'Lucky',
  'Cosmic', 'Sunny', 'Quiet', 'Noble', 'Happy', 'Keen', 'Vivid', 'Brave',
  'Clear', 'Fresh', 'Kind', 'Lively', 'Merry', 'Nimble', 'Proud', 'Rapid',
  'Amber', 'Azure', 'Coral', 'Golden', 'Silver', 'Velvet', 'Wild', 'Zesty',
] as const

const NOUNS = [
  'Comet', 'Panda', 'Orbit', 'River', 'Maple', 'Falcon', 'Pixel', 'Cloud',
  'Cedar', 'Nova', 'Harbor', 'Lotus', 'Meadow', 'Pepper', 'Quill', 'Sparrow',
  'Tide', 'Willow', 'Breeze', 'Canyon', 'Drift', 'Ember', 'Glide', 'Horizon',
] as const

/** adjective + noun + 3 digits, e.g. CuriousComet482 — never from email or Google name. */
export function generatePublicUsername(random: () => number = Math.random): string {
  for (let i = 0; i < 40; i++) {
    const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]!
    const noun = NOUNS[Math.floor(random() * NOUNS.length)]!
    const digits = String(Math.floor(random() * 900) + 100) // 100–999
    const candidate = `${adjective}${noun}${digits}`
    if (nicknameSchema.safeParse(candidate).success) return candidate
  }
  return `Viewer${String(Math.floor(random() * 900000) + 100000)}`
}

export function isGeneratedUsernameFormat(name: string): boolean {
  return /^[A-Z][a-z]+[A-Z][a-z]+[0-9]{3}$/.test(name) || /^Viewer[0-9]{6}$/.test(name)
}
