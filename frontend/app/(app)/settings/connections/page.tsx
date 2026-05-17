import AppShell from '@/components/layout/AppShell'
import ConnectionsClient from './ConnectionsClient'

export const metadata = { title: 'Connections — The FOUND3RY' }

export default function ConnectionsPage() {
  return (
    <AppShell>
      <ConnectionsClient />
    </AppShell>
  )
}
