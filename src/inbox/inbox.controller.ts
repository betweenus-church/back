import { Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import { MemberGuard } from "../auth/auth.guard";
import { ApiRequest } from "../auth/auth.types";
import { InboxService } from "./inbox.service";

@Controller("inbox")
@UseGuards(MemberGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}
  @Get() list(@Req() req: ApiRequest) { return this.inbox.list(req.member!.id); }
  @Post("read-all") readAll(@Req() req: ApiRequest) { return this.inbox.readAll(req.member!.id); }
  @Post(":id/read") read(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) { return this.inbox.read(req.member!.id, id); }
}
