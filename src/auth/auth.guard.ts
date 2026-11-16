import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { ApiRequest } from "./auth.types";

@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    req.member = this.auth.member(req);
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  canActivate(context: ExecutionContext) {
    this.auth.session(context.switchToHttp().getRequest<ApiRequest>(), "admin");
    return true;
  }
}
