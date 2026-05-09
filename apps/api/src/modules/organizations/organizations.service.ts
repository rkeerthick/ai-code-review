import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { OrgRole } from '@prisma/client';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(name: string, userId: string) {
    const slug = this.generateSlug(name);

    const existing = await this.prisma.organization.findUnique({ where: { slug } });
    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name, slug: finalSlug },
      });
      await tx.organizationMember.create({
        data: { organizationId: org.id, userId, role: 'OWNER' },
      });
      return org;
    });
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      include: {
        subscription: true,
        _count: {
          select: {
            members: true,
            repositories: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async listMembers(orgId: string) {
    return this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async inviteMember(orgId: string, email: string, role: OrgRole, invitedById: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: {
        _count: { select: { members: true } },
      },
    });

    if (org.maxMembers !== -1 && (org as any)._count.members >= org.maxMembers) {
      throw new ForbiddenException(`Plan limit: max ${org.maxMembers} members`);
    }

    const existingInvite = await this.prisma.invitation.findFirst({
      where: { organizationId: orgId, email, status: 'PENDING' },
    });
    if (existingInvite) throw new ConflictException('Invitation already sent');

    return this.prisma.invitation.create({
      data: {
        organizationId: orgId,
        email,
        role,
        invitedById,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
  }

  async removeMember(orgId: string, userId: string, requesterId: string) {
    if (userId === requesterId) {
      throw new ForbiddenException('Cannot remove yourself. Transfer ownership first.');
    }

    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }

    await this.prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
  }

  async updateMemberRole(orgId: string, userId: string, role: OrgRole) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
    });
    if (!member) throw new NotFoundException('Member not found');

    return this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      data: { role },
    });
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
  }
}
