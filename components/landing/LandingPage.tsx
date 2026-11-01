import Link from 'next/link'
import './landing.css'

type Props = { liveId?: string }

const steps = [
  { title: 'Write or upload.', text: 'Text or an image, with a live preview first.' },
  { title: 'We review it.', text: 'Track pending, approved, scheduled, aired.' },
  { title: 'Go live.', text: 'Get notified and share your moment.' },
]

const featured = [
  { title: 'Be the first to appear', note: 'Your nickname, on screen' },
  { title: 'Your message could be here', note: 'Reviewed within a day' },
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

export default function LandingPage({ liveId }: Props) {
  const id = validLiveId(liveId)

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
          <Link href="/auth" className="wb-signin">
            <span className="wb-long">Sign in with Google</span>
            <span className="wb-short">Sign in</span>
          </Link>
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
                  <h2>Stream starts soon</h2>
                  <p>Send a message or picture now. Approved submissions will be among the first on screen.</p>
                </div>
              )}
            </div>
          </section>

          <aside className="wb-card">
            <div className="wb-eyebrow">SUBMISSIONS OPEN</div>
            <h1>Your voice. The world&apos;s screen.</h1>
            <p className="wb-lead">
              Send a message or a picture. Once our team reviews it, it can appear on the live stream.
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
          <h2>Recently featured</h2>
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
          <h2>Themes coming to the stream</h2>
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
