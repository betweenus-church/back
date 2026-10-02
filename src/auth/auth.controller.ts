import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AdminGuard } from "./auth.guard";
import { ApiRequest, ApiResponse } from "./auth.types";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("signup") signup(@Body() body: unknown, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.signup(body, res); }
  @Get("me") me(@Req() req: ApiRequest) { const m = this.auth.member(req, false); return { id: m.id, name: m.name, church: m.church, status: m.status, reason: m.reason, hasPassword: Boolean(m.password_hash), mustChangePassword: Boolean(m.must_change_password) }; }
  @Post("login") memberLogin(@Body() body: unknown, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.memberLogin(body, res); }
  @Post("password") setMemberPassword(@Req() req: ApiRequest, @Body() body: unknown) { return this.auth.setMemberPassword(req, body); }
  @Post("change-password") changeMemberPassword(@Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse, @Body() body: unknown) { return this.auth.changeMemberPassword(req, res, body); }
  @Post("logout") logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.logout(req, res, "member"); }
  @Post("admin/login") login(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.adminLogin(body, req, res); }
  @Get("admin/me") @UseGuards(AdminGuard) adminMe() { return { role: "admin" }; }
  @Post("admin/logout") @UseGuards(AdminGuard) adminLogout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.logout(req, res, "admin"); }
}
