export function Logo({ size='md' }: { size?: 'sm'|'md'|'lg' }) {
  const s = { sm:'text-lg', md:'text-xl', lg:'text-3xl' }[size]
  return (
    <div className={`font-display font-bold tracking-tight ${s} flex items-baseline gap-2`}>
      <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-900 text-white">W</span>
      <span>WrittenBoard</span>
      <span className="text-[10px] font-sans font-medium tracking-[0.2em] uppercase text-zinc-500 ml-1">LIVE</span>
    </div>
  )
}
