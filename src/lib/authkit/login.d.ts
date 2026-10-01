/**
 * src/lib/authkit/login.d.ts — types for the copied login.js helper.
 */

export interface LoginUser {
  id: number | string
  name: string
  email: string
  role: string
}

export interface LoginResult {
  ok: boolean
  status?: number
  error?: string
  token?: string
  user?: LoginUser
}

/** Portal-compatible credential login against MSSQL user_ptrj + RS256 keys. */
export declare function loginWithCredentials(args?: {
  username?: string
  password?: string
  keysDir?: string
}): Promise<LoginResult>
