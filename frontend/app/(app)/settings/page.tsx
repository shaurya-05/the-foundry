import AppShell from '@/components/layout/AppShell'
import SettingsClient from './SettingsClient'

export const metadata = { title: 'Settings — The FOUND3RY' }

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsClient />
    </AppShell>
  )
}
