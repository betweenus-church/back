import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthController } from "./auth.controller";
import { AdminGuard, MemberGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { AvatarService } from "./avatar.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, AvatarService, AdminGuard, MemberGuard],
  exports: [AuthService, AdminGuard, MemberGuard],
})
export class AuthModule {}
