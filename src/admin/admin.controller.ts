import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../auth/auth.guard";
import { AuthService } from "../auth/auth.service";
import { ApiRequest } from "../auth/auth.types";
import { DailyWordService } from "../daily-word/daily-word.service";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly auth: AuthService, private readonly dailyWord: DailyWordService) {}
  @Get("dashboard") dashboard() { return this.admin.dashboard(); }
  @Get("approvals") approvals() { return this.admin.approvals(); }
  @Post("approvals/:id/approve") approve(@Param("id", ParseIntPipe) id: number) { return this.admin.decision(id, "approved", {}); }
  @Post("approvals/:id/reject") reject(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) { return this.admin.decision(id, "rejected", body); }
  @Get("members") members() { return this.admin.members(); }
  @Patch("members/:id") updateMember(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) { return this.admin.updateMember(id, body); }
  @Patch("members/:id/status") memberStatus(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) { return this.admin.memberStatus(id, body); }
  @Post("members/:id/reset-password") resetMemberPassword(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) { this.auth.requireOwner(req); return this.admin.resetMemberPassword(id); }
  @Get("reports") reports() { return this.admin.reports(); }
  @Get("reports/:id/image") reportImage(@Param("id", ParseIntPipe) id: number) { return this.admin.reportImage(id); }
  @Post("reports/:id/resolve") resolve(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) { return this.admin.resolveReport(id, body); }
  @Get("settings") settings() { return this.admin.settings(); }
  @Patch("settings") updateSettings(@Body() body: unknown) { return this.admin.updateSettings(body); }
  @Get("accounts") accounts() { return this.admin.accounts(); }
  @Post("accounts") createAccount(@Req() req: ApiRequest, @Body() body: unknown) { this.auth.requireOwner(req); return this.admin.createAccount(body); }
  @Delete("accounts/:id") deleteAccount(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) { this.auth.requireOwner(req); return this.admin.deleteAccount(id); }
  @Get("notices") notices() { return this.admin.notices(); }
  @Get("daily-words") dailyWords() { return this.dailyWord.list(); }
  @Put("daily-words/:date") saveDailyWord(@Param("date") date: string, @Body() body: unknown) { return this.dailyWord.save(date, body); }
  @Post("notices") createNotice(@Body() body: unknown) { return this.admin.createNotice(body); }
  @Patch("notices/:id") updateNotice(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) { return this.admin.updateNotice(id, body); }
}
