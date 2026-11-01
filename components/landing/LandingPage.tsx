import Link from 'next/link'
import { SiteNav } from '@/components/nav/SiteNav'
import './landing.css'

type Props = {
  liveId?: string
  /** Full channel URL, e.g. https://www.youtube.com/@WrittenBoard */
  youtubeChannelUrl?: string
  nowShowing?: string
  upNext?: string
  signedIn?: boolean
  isStaff?: boolean
}

const steps = [
  { title: 'Submit.', text: 'Share text, an image or a short video within the stated limits.' },
  { title: 'We review it.', text: 'A human moderator checks every submission before anything can air.' },
  { title: 'It may go live.', text: 'Approved content may appear on the WrittenBoard YouTube livestream.' },
]

const shareIdeas = [
  { title: 'Messages', note: 'Short text viewers can read on stream' },
  { title: 'Photos & art', note: 'Images within the upload limits' },
  { title: 'Short clips', note: 'Videos up to 15 seconds' },
]

const themes = [
  { title: 'Good morning wishes', text: 'Start-the-day greetings shared by viewers.' },
  { title: 'Art hour', text: 'Drawings and pictures, one after another.' },
  { title: 'Festival specials', text: 'Seasonal greetings for holidays and celebrations.' },
]

function validLiveId(id?: string) {
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

function safeChannelUrl(url?: string) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    if (!['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(parsed.hostname)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export default function LandingPage({ liveId, youtubeChannelUrl, nowShowing, upNext, signedIn, isStaff }: Props) {
  const id = validLiveId(liveId)
  const channelUrl = safeChannelUrl(youtubeChannelUrl)
  const youtubeHref = channelUrl || (id ? `https://www.youtube.com/watch?v=${id}` : null)
  const showing = nowShowing || 'Nothing on air yet'
  const next = upNext || 'The queue is open'
  const isLive = Boolean(id)

  return (
    <div className="wb">
      <SiteNav variant="landing" signedIn={signedIn} isStaff={isStaff} />

      <main className="wb-main">
        <div className="wb-hero">
          <section className="wb-player" aria-label={isLive ? 'Live stream' : 'Broadcast offline'}>
            <div className={`wb-screen ${isLive ? 'wb-screen-live' : 'wb-screen-offline'}`}>
              {id ? (
                <>
                  <span className="wb-badge wb-badge-live">
                    <span className="wb-dot wb-dot-live" />
                    LIVE
                  </span>
                  <iframe
                    className="wb-iframe"
                    src={`https://www.youtube.com/embed/${id}?rel=0`}
                    title="WrittenBoard live stream"
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                  />
                </>
              ) : (
                <div className="wb-offline">
                  <span className="wb-badge">
                    <span className="wb-dot" />
                    OFFLINE
                  </span>
                  <svg aria-hidden="true" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#E9E7F0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M10 9.5l5 2.5-5 2.5z" />
                  </svg>
                  <h2>Broadcast is offline</h2>
                  <p>You can still submit content for review. Approved items may appear on a future livestream.</p>
                </div>
              )}
            </div>
            {youtubeHref && (
              <a className="wb-yt" href={youtubeHref} target="_blank" rel="noopener noreferrer">
                Watch WrittenBoard on YouTube <span aria-hidden="true">↗</span>
              </a>
            )}
          </section>

          <aside className="wb-card">
            <div className="wb-eyebrow">SUBMISSIONS OPEN</div>
            <h1>Your message. Live on WrittenBoard.</h1>
            <p className="wb-lead">
              Submit a message, photo or artwork. After human review and approval, it could appear on our YouTube livestream.
            </p>
            <Link href={signedIn ? '/submit' : '/auth'} className="wb-cta">Submit yours</Link>
            <p className="wb-hint">
              {signedIn
                ? "You're signed in. Your content is ready to submit."
                : 'Sign in to submit your content.'}
            </p>

            <h2 id="how" className="wb-how-title">How it works</h2>
            <ol className="wb-steps">
              {steps.map((s, i) => (
                <li key={s.title}>
                  <span className="wb-step-num">{i + 1}</span>
                  <span><b>{s.title}</b> {s.text}</span>
                </li>
              ))}
            </ol>
            <p className="wb-fine">
              Only reviewed content is shown on stream.{' '}
              <Link href="/guidelines">Community Guidelines</Link>
            </p>
          </aside>

          <section className="wb-status" aria-label="Stream status">
            <div className="wb-status-card">
              <div className="wb-label">NOW SHOWING</div>
              <div className="wb-status-text">{showing}</div>
            </div>
            <div className="wb-status-card">
              <div className="wb-label">UP NEXT</div>
              <div className="wb-status-text">{next}</div>
            </div>
          </section>
        </div>

        <section id="share" className="wb-section">
          <h2>What you can share</h2>
          <p className="wb-section-note">
            These are examples of supported formats — not a feed of recent submissions.
          </p>
          <div className="wb-grid">
            {shareIdeas.map((f) => (
              <div key={f.title} className="wb-idea">
                <span className="wb-idea-title">{f.title}</span>
                <span className="wb-idea-note">{f.note}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="themes" className="wb-section">
          <h2>Theme ideas</h2>
          <p className="wb-section-note">
            Editorial inspiration only. These are not confirmed broadcast times or a fixed schedule.
          </p>
          <div className="wb-grid">
            {themes.map((t) => (
              <div key={t.title} className="wb-theme">
                <b>{t.title}</b>
                <p>{t.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="wb-footer">
        <nav aria-label="Footer">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/guidelines">Community Guidelines</Link>
          <Link href="/copyright">Copyright</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <span>© 2026 WrittenBoard</span>
      </footer>
    </div>
  )
}
