import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: OrgRole[]) =>
  Reflect.metadata(ROLES_KEY, roles);

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
  VIEWER: 1,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.params?.orgId ?? request.user?.currentOrgId;

    if (!orgId) throw new ForbiddenException('Organization context required');

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
      select: { role: true },
    });

    if (!membership) throw new ForbiddenException('Not a member of this organization');

    const userLevel = ROLE_HIERARCHY[membership.role];
    const minRequired = Math.min(...requiredRoles.map((r) => ROLE_HIERARCHY[r]));

    if (userLevel < minRequired) {
      throw new ForbiddenException(
        `Requires one of: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
