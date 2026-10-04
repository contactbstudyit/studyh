import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getAdminMfaStatus, hasAdminTotpAal2 } from '@/lib/admin-mfa'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const path = request.nextUrl.pathname
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    if (path.startsWith('/admin') && path !== '/admin/login') {
      return new NextResponse('Admin authentication is unavailable.', { status: 503 })
    }
    return response
  }
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value))
      },
    },
  })

  const { data: verified } = await supabase.auth.getClaims()
  const claims = verified?.claims
  if (path.startsWith('/admin') && path !== '/admin/login') {
    const redirectTo = (pathname: string, params?: Record<string, string>) => {
      const target = request.nextUrl.clone()
      target.pathname = pathname
      target.search = ''
      for (const [key, value] of Object.entries(params ?? {})) target.searchParams.set(key, value)
      const redirectResponse = NextResponse.redirect(target)
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }
    const userId = claims?.sub
    if (!userId) {
      return redirectTo('/admin/login', { next: path })
    }
    const { data: membership, error } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
    if (error) {
      if (process.env.NODE_ENV === 'development') console.error('[admin-auth] proxy membership query failed', {
        projectHost: new URL(url).host,
        userId,
        table: 'public.admins',
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      return redirectTo('/admin/login', { membershipCheck: 'failed' })
    }
    if (!membership) {
      if (process.env.NODE_ENV === 'development') console.warn('[admin-auth] proxy membership query returned no row', {
        projectHost: new URL(url).host,
        userId,
        table: 'public.admins',
        result: membership,
      })
      return redirectTo('/')
    }

    const mfaStatus = await getAdminMfaStatus(supabase)
    if (mfaStatus.error) {
      if (process.env.NODE_ENV === 'development') console.error('[admin-auth] MFA assurance check failed', {
        userId,
        message: mfaStatus.error.message,
        code: 'code' in mfaStatus.error ? mfaStatus.error.code : undefined,
      })
      return redirectTo('/admin/login', { mfaCheck: 'failed' })
    }

    const isMfaRoute = path === '/admin/login/mfa'
    if (isMfaRoute) {
      if (hasAdminTotpAal2(mfaStatus)) return redirectTo('/admin')
    } else if (!hasAdminTotpAal2(mfaStatus)) {
      return redirectTo('/admin/login/mfa')
    }
  }
  return response
}

export const config = {
  matcher: ['/', '/admin/:path*'],
}
