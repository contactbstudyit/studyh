import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response
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
  const path = request.nextUrl.pathname
  if (path.startsWith('/admin') && path !== '/admin/login') {
    const userId = claims?.sub
    if (!userId) {
      const target = request.nextUrl.clone()
      target.pathname = '/admin/login'
      target.searchParams.set('next', path)
      return NextResponse.redirect(target)
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
      const target = request.nextUrl.clone()
      target.pathname = '/admin/login'
      target.searchParams.set('membershipCheck', 'failed')
      return NextResponse.redirect(target)
    }
    if (!membership) {
      if (process.env.NODE_ENV === 'development') console.warn('[admin-auth] proxy membership query returned no row', {
        projectHost: new URL(url).host,
        userId,
        table: 'public.admins',
        result: membership,
      })
      const target = request.nextUrl.clone()
      target.pathname = '/'
      target.search = ''
      return NextResponse.redirect(target)
    }
  }
  return response
}

export const config = {
  matcher: ['/', '/admin/:path*'],
}
