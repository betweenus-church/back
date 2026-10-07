import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthService } from "./auth.service";
import { AvatarService } from "./avatar.service";
import { AdminGuard } from "./auth.guard";
import { ApiRequest, ApiResponse } from "./auth.types";
import { ImageUpload } from "../images/optimized-upload";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly avatar: AvatarService) {}
  @Post("signup") signup(@Body() body: unknown, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.signup(body, res); }
  @Get("me") me(@Req() req: ApiRequest) { return this.auth.profile(this.auth.member(req, false)); }
  @Get("me/avatar") avatarImage(@Req() req: ApiRequest) { return this.avatar.image(this.auth.member(req)); }
  @Get("members/:id/avatar") memberAvatarImage(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) {
    this.auth.member(req);
    return this.avatar.memberImage(id);
  }
  @Post("me/avatar") @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async replaceAvatar(@Req() req: ApiRequest, @UploadedFile() image?: ImageUpload) {
    return this.auth.profile(await this.avatar.replace(this.auth.member(req), image));
  }
  @Delete("me/avatar") removeAvatar(@Req() req: ApiRequest) {
    return this.auth.profile(this.avatar.remove(this.auth.member(req)));
  }
  @Post("login") memberLogin(@Body() body: unknown, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.memberLogin(body, res); }
  @Post("password") setMemberPassword(@Req() req: ApiRequest, @Body() body: unknown) { return this.auth.setMemberPassword(req, body); }
  @Post("change-password") changeMemberPassword(@Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse, @Body() body: unknown) { return this.auth.changeMemberPassword(req, res, body); }
  @Post("logout") logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.logout(req, res, "member"); }
  @Post("admin/login") login(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.adminLogin(body, req, res); }
  @Get("admin/me") @UseGuards(AdminGuard) adminMe() { return { role: "admin" }; }
  @Post("admin/logout") @UseGuards(AdminGuard) adminLogout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: ApiResponse) { return this.auth.logout(req, res, "admin"); }
}
