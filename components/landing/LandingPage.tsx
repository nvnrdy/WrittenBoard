import Link from 'next/link'
import './landing.css'

type Props = {
  liveId?: string
  /** Full channel URL, e.g. https://www.youtube.com/@WrittenBoard */
  youtubeChannelUrl?: string
}

const steps = [
  { title: 'Write or upload.', text: 'Text or an image, with a live preview first.' },
  { title: 'We review it.', text: 'Track pending, approved, scheduled, aired.' },
  { title: 'Go live.', text: 'Get notified and share your moment.' },
]

const featured = [
  { title: 'Be among the first to feature', note: 'Your nickname, on screen' },
  { title: 'Your message on the big screen', note: 'Every submission is reviewed before broadcast' },
  { title: 'Your picture could be here', note: 'Images are welcome too' },
]

const themes = [
  { title: 'Good morning wishes', text: 'Start the day with a message from the community.' },
  { title: 'Art hour', text: 'Drawings and pictures, one after another.' },
  { title: 'Festival specials', text: 'Greetings for Diwali, Ugadi, Independence Day and more.' },
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

export default function LandingPage({ liveId, youtubeChannelUrl }: Props) {
  const id = validLiveId(liveId)
  const channelUrl = safeChannelUrl(youtubeChannelUrl)
  const youtubeHref = channelUrl || (id ? `https://www.youtube.com/watch?v=${id}` : null)

  return (
    <div className="wb">
      <header className="wb-header">
        <Link href="/" className="wb-logo">
          <span className="wb-logo-mark">W</span>
          WrittenBoard
        </Link>
        <nav className="wb-nav" aria-label="Main">
          <a href="#how" className="wb-nav-link">How it works</a>
          <a href="#featured" className="wb-nav-link">Featured</a>
          <Link href="/auth" className="wb-signin">Sign In</Link>
        </nav>
      </header>

      <main className="wb-main">
        <div className="wb-hero">
          <section className="wb-player" aria-label="Live stream">
            <div className="wb-screen">
              {id ? (
                <iframe
                  className="wb-iframe"
                  src={`https://www.youtube.com/embed/${id}?rel=0`}
                  title="WrittenBoard live stream"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
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
                  <h2>Our next broadcast is coming soon.</h2>
                  <p>You can submit your content now for review.</p>
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
              Submit your message, photo or artwork. After review and approval, it could appear on our YouTube livestream.
            </p>
            <Link href="/submit" className="wb-cta">Submit yours</Link>
            <p className="wb-hint">Sign in with Google to submit. Watching is free.</p>

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
              <div className="wb-status-text">Nothing on air yet</div>
            </div>
            <div className="wb-status-card">
              <div className="wb-label">UP NEXT</div>
              <div className="wb-status-text">The queue is open</div>
            </div>
          </section>
        </div>

        <section id="featured" className="wb-section">
          <h2>Recently on WrittenBoard</h2>
          <p className="wb-section-note">Introductory placeholders — real featured posts will appear here after the first broadcasts.</p>
          <div className="wb-grid">
            {featured.map((f) => (
              <div key={f.title} className="wb-ghost">
                <span className="wb-ghost-title">{f.title}</span>
                <span className="wb-ghost-note">{f.note}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="wb-section">
          <h2>Upcoming broadcast themes</h2>
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
