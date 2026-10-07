import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AdminGuard, MemberGuard } from "../auth/auth.guard";
import { NewsService, NewsUpload } from "./news.service";

const coverUpload = FileInterceptor("cover", { limits: { fileSize: 10 * 1024 * 1024 } });

@Controller("news")
@UseGuards(MemberGuard)
export class MemberNewsController {
  constructor(private readonly news: NewsService) {}
  @Get() list(@Query("category") category?: string) { return this.news.memberList(category); }
  @Get(":id") detail(@Param("id", ParseIntPipe) id: number) { return this.news.memberDetail(id); }
  @Get(":id/cover") cover(@Param("id", ParseIntPipe) id: number) { return this.news.cover(id, false); }
}

@Controller("admin/news")
@UseGuards(AdminGuard)
export class AdminNewsController {
  constructor(private readonly news: NewsService) {}
  @Get() list() { return this.news.adminList(); }
  @Get(":id") detail(@Param("id", ParseIntPipe) id: number) { return this.news.adminDetail(id); }
  @Get(":id/cover") cover(@Param("id", ParseIntPipe) id: number) { return this.news.cover(id, true); }
  @Post() @UseInterceptors(coverUpload) create(@Body() body: unknown, @UploadedFile() cover?: NewsUpload) { return this.news.create(body, cover); }
  @Patch(":id") @UseInterceptors(coverUpload) update(@Param("id", ParseIntPipe) id: number, @Body() body: unknown, @UploadedFile() cover?: NewsUpload) { return this.news.update(id, body, cover); }
  @Delete(":id") delete(@Param("id", ParseIntPipe) id: number) { return this.news.delete(id); }
}
