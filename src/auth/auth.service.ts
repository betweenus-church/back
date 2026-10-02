import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { ApiRequest, ApiResponse, MemberRow } from "./auth.types";

type SessionRow = { member_id: number | null; admin_id: number | null; role: string; expires_at: number };

function cookie(req: ApiRequest, name: string) {
  const header = req.headers.cookie;
  return (typeof header === "string" ? header : "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verifyPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  if (!salt || !encoded) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(encoded, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
function value(body: unknown, key: string, min: number, max: number) {
  const text = (body as Record<string, unknown> | null)?.[key];
  if (typeof text !== "string" || text.trim().length < min || text.trim().length > max) throw new BadRequestException(`${key} must be ${min}-${max} characters`);
  return text.trim();
}
function memberPassword(body: unknown, key = "password") {
  const password = (body as Record<string, unknown> | null)?.[key];
  if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new BadRequestException("Password must contain 12-128 characters");
  return password;
}
const dummyMemberHash = passwordHash("unused-member-login-password");

@Injectable()
export class AuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  private memberAttempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly data: DatabaseService) {
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
    if (!process.env.CHURCH_NAME) throw new Error("CHURCH_NAME is required");
  }

  private setCookie(res: ApiResponse, name: string, token: string, seconds: number) {
    res.setHeader("Set-Cookie", `${name}=${token}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${seconds}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`);
  }

  private issue(res: ApiResponse, name: string, role: "member" | "admin", memberId: number | null, adminId: number | null = null) {
    const token = randomBytes(32).toString("base64url");
    const age = role === "admin" ? 8 * 3600 : 30 * 86400;
    this.data.db.prepare("INSERT INTO sessions(token_hash,member_id,admin_id,role,expires_at) VALUES(?,?,?,?,?)").run(hash(token), memberId, adminId, role, Date.now() + age * 1000);
    this.setCookie(res, name, token, age);
  }

  session(req: ApiRequest, role: "member" | "admin") {
    const token = cookie(req, role === "admin" ? "sai_admin" : "sai_member");
    if (!token) throw new UnauthorizedException();
    const session = this.data.db.prepare("SELECT member_id,admin_id,role,expires_at FROM sessions WHERE token_hash=?").get(hash(token)) as SessionRow | undefined;
    if (!session || session.role !== role || session.expires_at <= Date.now()) throw new UnauthorizedException();
    return session;
  }

  member(req: ApiRequest, approved = true) {
    const session = this.session(req, "member");
    const member = this.data.db.prepare("SELECT * FROM members WHERE id=?").get(session.member_id) as MemberRow | undefined;
    if (!member) throw new UnauthorizedException();
    if (approved && member.status !== "approved") throw new ForbiddenException("Approval required");
    if (approved && member.must_change_password) throw new ForbiddenException("임시 비밀번호를 변경해 주세요.");
    return member;
  }

  signup(body: unknown, res: ApiResponse) {
    const name = value(body, "name", 1, 30);
    const phone = value(body, "phone", 10, 13).replace(/\D/g, "");
    const church = value(body, "church", 2, 60);
    if (!/^01[016789]\d{7,8}$/.test(phone)) throw new BadRequestException("Invalid phone number");
    if (church.replace(/\s/g, "") !== process.env.CHURCH_NAME!.replace(/\s/g, "")) throw new BadRequestException("Unknown church");
    if ((body as Record<string, unknown>).consent !== true) throw new BadRequestException("Consent is required");
    const existing = this.data.db.prepare("SELECT id FROM members WHERE phone=?").get(phone);
    if (existing) throw new ConflictException("이미 가입 신청되었거나 가입된 전화번호예요. 로그인해 주세요.");
    const password = memberPassword(body);
    const now = new Date().toISOString();
    const id = Number(this.data.db.prepare("INSERT INTO members(name,phone,church,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(name, phone, church, passwordHash(password), now, now).lastInsertRowid);
    this.issue(res, "sai_member", "member", id);
    return { id, name, church, status: "pending", hasPassword: true, mustChangePassword: false };
  }

  memberLogin(body: unknown, res: ApiResponse) {
    const phone = typeof (body as Record<string, unknown> | null)?.phone === "string" ? String((body as { phone: string }).phone).replace(/\D/g, "") : "";
    const password = (body as Record<string, unknown> | null)?.password;
    if (!/^01[016789]\d{7,8}$/.test(phone) || typeof password !== "string" || password.length > 128) throw new UnauthorizedException("전화번호 또는 비밀번호를 확인해 주세요.");
    const attempt = this.memberAttempts.get(phone);
    if (attempt && attempt.count >= 5 && attempt.until > Date.now()) throw new HttpException("잠시 후 다시 시도해 주세요.", HttpStatus.TOO_MANY_REQUESTS);
    const row = this.data.db.prepare("SELECT * FROM members WHERE phone=?").get(phone) as MemberRow | undefined;
    const valid = verifyPassword(password, row?.password_hash || dummyMemberHash);
    if (!row?.password_hash || !valid) {
      this.memberAttempts.set(phone, { count: (attempt?.until && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw new UnauthorizedException("전화번호 또는 비밀번호를 확인해 주세요.");
    }
    this.memberAttempts.delete(phone);
    this.issue(res, "sai_member", "member", row.id);
    return { id: row.id, name: row.name, church: row.church, status: row.status, reason: row.reason, hasPassword: true, mustChangePassword: Boolean(row.must_change_password) };
  }

  setMemberPassword(req: ApiRequest, body: unknown) {
    const member = this.member(req, false);
    if (member.password_hash) throw new ConflictException("Password already set");
    const password = memberPassword(body);
    this.data.db.prepare("UPDATE members SET password_hash=?,updated_at=? WHERE id=?").run(passwordHash(password), new Date().toISOString(), member.id);
    return { hasPassword: true };
  }

  changeMemberPassword(req: ApiRequest, res: ApiResponse, body: unknown) {
    const member = this.member(req, false);
    if (!member.password_hash) throw new ConflictException("비밀번호를 먼저 설정해 주세요.");
    const currentPassword = (body as Record<string, unknown> | null)?.currentPassword;
    if (typeof currentPassword !== "string" || currentPassword.length > 128 || !verifyPassword(currentPassword, member.password_hash)) {
      throw new UnauthorizedException("현재 비밀번호가 올바르지 않아요.");
    }
    const newPassword = memberPassword(body, "newPassword");
    if (verifyPassword(newPassword, member.password_hash)) throw new BadRequestException("현재 비밀번호와 다른 비밀번호를 입력해 주세요.");
    const db = this.data.db;
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE members SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?").run(passwordHash(newPassword), new Date().toISOString(), member.id);
      db.prepare("DELETE FROM sessions WHERE member_id=?").run(member.id);
      this.issue(res, "sai_member", "member", member.id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { mustChangePassword: false };
  }

  adminLogin(body: unknown, req: ApiRequest, res: ApiResponse) {
    const address = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "local").split(",")[0].trim();
    const attempt = this.attempts.get(address);
    if (attempt && attempt.count >= 5 && attempt.until > Date.now()) throw new ForbiddenException("Too many attempts. Try later.");
    const password = typeof (body as Record<string, unknown> | null)?.password === "string" ? (body as { password: string }).password : "";
    const account = typeof (body as Record<string, unknown> | null)?.account === "string" ? String((body as { account: string }).account).trim() : "";
    const row = account ? this.data.db.prepare("SELECT id,password_hash FROM admin_accounts WHERE account=?").get(account) as { id: number; password_hash: string } | undefined : undefined;
    const valid = account ? Boolean(row && verifyPassword(password, row.password_hash)) : timingSafeEqual(Buffer.from(hash(password)), Buffer.from(hash(process.env.ADMIN_PASSWORD!)));
    if (!valid) {
      this.attempts.set(address, { count: (attempt?.until && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw new UnauthorizedException("Invalid administrator password");
    }
    this.attempts.delete(address);
    this.issue(res, "sai_admin", "admin", null, row?.id ?? null);
    return { role: "admin", account: account || "root" };
  }

  requireOwner(req: ApiRequest) {
    if (this.session(req, "admin").admin_id !== null) throw new ForbiddenException("Owner permission required");
  }

  logout(req: ApiRequest, res: ApiResponse, role: "member" | "admin") {
    const name = role === "admin" ? "sai_admin" : "sai_member";
    const token = cookie(req, name);
    if (token) this.data.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
    this.setCookie(res, name, "", 0);
    return { ok: true };
  }
}
