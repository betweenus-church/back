import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { MemberGuard } from "../auth/auth.guard";
import { ApiRequest } from "../auth/auth.types";
import { MiniHomeService } from "./mini-home.service";

@Controller("mini-home")
@UseGuards(MemberGuard)
export class MiniHomeController {
  constructor(private readonly homes: MiniHomeService) {}
  @Get() get(@Req() req: ApiRequest) { return this.homes.snapshot(req.member!.id); }
  @Get("members/:id") visit(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) { return this.homes.visit(id, req.member!.church); }
  @Post("purchase") purchase(@Req() req: ApiRequest, @Body() body: unknown) { return this.homes.purchase(req.member!.id, body); }
  @Patch("equip") equip(@Req() req: ApiRequest, @Body() body: unknown) { return this.homes.equip(req.member!.id, body); }
  @Patch("message") message(@Req() req: ApiRequest, @Body() body: unknown) { return this.homes.updateMessage(req.member!.id, body); }
}
