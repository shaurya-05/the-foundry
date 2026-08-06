'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

/** Onboarding ask step → H3RO dashboard (text backup removed). */
export default function OnboardingAskPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    if (!user) { router.push('/login'); return }
    router.replace('/dashboard')
  }, [user, loading, router])

  return null
}
