import { SiteNav } from '@/components/nav/SiteNav'

export function AppHeader({
  isStaff,
  signedIn,
}: {
  isStaff?: boolean
  signedIn?: boolean
}) {
  return <SiteNav variant="app" signedIn={signedIn} isStaff={isStaff} />
}
