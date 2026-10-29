'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-sm text-zinc-600">{error.message || 'Unexpected error'}</p>
        <button onClick={reset} className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white">Try again</button>
      </div>
    </div>
  )
}
