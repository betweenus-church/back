import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MemberGuard } from "../auth/auth.guard";
import { ApiRequest } from "../auth/auth.types";
import { CommunityService, Upload } from "./community.service";

@Controller()
@UseGuards(MemberGuard)
export class CommunityController {
    constructor(private readonly community: CommunityService) {}
    @Get("community") snapshot(@Req() req: ApiRequest) {
        return this.community.snapshot(req.member!.id);
    }
    @Get("notices/:id") notice(@Param("id", ParseIntPipe) id: number) {
        return this.community.noticeById(id);
    }
    @Post("words") addWord(@Req() req: ApiRequest, @Body() body: unknown) {
        return this.community.addWord(req.member!.id, body);
    }
    @Get("words") words(@Req() req: ApiRequest, @Query("date") date?: string) {
        return this.community.words(req.member!.id, date);
    }
    @Delete("words/:id") deleteWord(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) {
        return this.community.deleteWord(req.member!.id, id);
    }
    @Post("photos") @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 10 * 1024 * 1024 } })) addPhoto(
        @Req() req: ApiRequest,
        @Body() body: unknown,
        @UploadedFile() file?: Upload,
    ) {
        return this.community.addPhoto(req.member!.id, body, file);
    }
    @Get("photos/:id") photo(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) {
        return this.community.photoById(id, req.member!.id);
    }
    @Get("photos/:id/image") image(@Param("id", ParseIntPipe) id: number) {
        return this.community.photoImage(id);
    }
    @Delete("photos/:id") deletePhoto(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) {
        return this.community.deletePhoto(req.member!.id, id);
    }
    @Post("photos/:id/like") like(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) {
        return this.community.likePhoto(req.member!.id, id);
    }
    @Post("photos/:id/comments") comment(
        @Req() req: ApiRequest,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: unknown,
    ) {
        return this.community.addComment(req.member!.id, id, body);
    }
    @Patch("photos/:photoId/comments/:id") editComment(
        @Req() req: ApiRequest,
        @Param("photoId", ParseIntPipe) photoId: number,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: unknown,
    ) {
        return this.community.editComment(req.member!.id, photoId, id, body);
    }
    @Delete("photos/:photoId/comments/:id") deleteComment(
        @Req() req: ApiRequest,
        @Param("photoId", ParseIntPipe) photoId: number,
        @Param("id", ParseIntPipe) id: number,
    ) {
        return this.community.deleteComment(req.member!.id, photoId, id);
    }
    @Post("prayers") addPrayer(@Req() req: ApiRequest, @Body() body: unknown) {
        return this.community.addPrayer(req.member!.id, body);
    }
    @Delete("prayers/:id") deletePrayer(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) {
        return this.community.deletePrayer(req.member!.id, id);
    }
    @Post("prayers/:id/pray") pray(@Req() req: ApiRequest, @Param("id", ParseIntPipe) id: number) {
        return this.community.pray(req.member!.id, id);
    }
    @Post("reports") report(@Req() req: ApiRequest, @Body() body: unknown) {
        return this.community.report(req.member!.id, body);
    }
}
