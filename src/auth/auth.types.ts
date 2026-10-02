export type MemberRow = { id: number; name: string; phone: string; church: string; status: string; reason: string | null; password_hash: string | null; must_change_password: number; created_at: string; updated_at: string };
export type ApiRequest = { headers: Record<string, string | string[] | undefined>; member?: MemberRow };
export type ApiResponse = { setHeader(name: string, value: string): void };
