import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

@Module({ imports: [AuthModule, DatabaseModule], controllers: [InboxController], providers: [InboxService], exports: [InboxService] })
export class InboxModule {}
