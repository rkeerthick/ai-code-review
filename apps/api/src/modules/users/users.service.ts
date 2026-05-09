import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, name: true, avatarUrl: true,
        role: true, githubUsername: true, emailVerified: true, createdAt: true,
        orgMemberships: {
          include: {
            organization: { select: { id: true, name: true, slug: true, plan: true } },
          },
        },
      },
    });
  }

  async updateProfile(id: string, data: { name?: string; avatarUrl?: string }) {
    return this.prisma.user.update({ where: { id }, data });
  }

  async changePassword(id: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (!user.passwordHash) throw new NotFoundException('No password set — use OAuth login');

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new NotFoundException('Current password incorrect');

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: newHash } });
  }

  async deleteAccount(id: string) {
    await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        email: `deleted_${id}@deleted.invalid`,
        passwordHash: null,
        githubTokenEnc: null,
      },
    });
  }
}
