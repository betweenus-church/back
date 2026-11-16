import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { MiniHomeController } from "./mini-home.controller";
import { MiniHomeService } from "./mini-home.service";

@Module({ imports: [AuthModule, DatabaseModule], controllers: [MiniHomeController], providers: [MiniHomeService], exports: [MiniHomeService] })
export class MiniHomeModule {}
