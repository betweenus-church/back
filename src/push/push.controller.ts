import { Body, Controller, Delete, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AdminGuard, MemberGuard } from "../auth/auth.guard";
import { ApiRequest } from "../auth/auth.types";
import { PushService } from "./push.service";

@Controller("push")
@UseGuards(MemberGuard)
export class MemberPushController {
  constructor(private readonly push: PushService) {}

  @Get("config") config() {
    return this.push.memberConfig();
  }

  @Post("subscriptions") subscribe(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.push.subscribe(req.member!.id, body);
  }

  @Post("status") status(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.push.status(req.member!.id, body);
  }

  @Delete("subscriptions") unsubscribe(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.push.unsubscribe(req.member!.id, body);
  }
}

@Controller("admin/push")
@UseGuards(AdminGuard)
export class AdminPushController {
  constructor(private readonly push: PushService) {}

  @Get("settings") settings() { return this.push.adminSettings(); }
  @Patch("settings") update(@Body() body: unknown) { return this.push.updateSettings(body); }
  @Post("send") send(@Body() body: unknown) { return this.push.sendAnnouncement(body); }
}
