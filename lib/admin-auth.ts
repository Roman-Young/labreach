import { NextRequest } from 'next/server'

export function checkAdminAuth(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-token')
  const password = process.env.ADMIN_PASSWORD
  if (!password) return false
  return token === password
}
