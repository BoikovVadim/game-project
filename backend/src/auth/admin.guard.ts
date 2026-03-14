import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as { id?: number; isAdmin?: boolean | number } | undefined;
    const isAdmin = user?.isAdmin === true || user?.isAdmin === 1;
    if (!isAdmin) {
      throw new ForbiddenException('Требуются права администратора');
    }
    return true;
  }
}
