import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-zinc-600">That route does not exist.</p>
        <Link href="/" className="mt-4 inline-block underline">Back home</Link>
      </div>
    </div>
  )
}
