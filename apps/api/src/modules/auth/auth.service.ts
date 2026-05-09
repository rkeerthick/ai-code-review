import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { User } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const created = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        emailVerified: false,
      },
      select: { id: true, email: true },
    });

    this.logger.log(`New user registered: ${created.email}`);

    const tokens = await this.tokenService.generateTokenPair(created.id, created.email);
    const user = await this.getProfile(created.id);
    return { user, ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase(), deletedAt: null },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Constant-time comparison — prevents timing attacks
    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.tokenService.generateTokenPair(user.id, user.email);
    const fullUser = await this.getProfile(user.id);
    return { user: fullUser, ...tokens };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const isValid = await this.tokenService.validateRefreshToken(userId, refreshToken);
    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: invalidate old refresh token
    await this.tokenService.revokeRefreshToken(userId, refreshToken);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const tokens = await this.tokenService.generateTokenPair(user.id, user.email);
    return tokens;
  }

  async logout(userId: string, refreshToken: string) {
    await this.tokenService.revokeRefreshToken(userId, refreshToken);
    this.logger.log(`User ${userId} logged out`);
  }

  async logoutAll(userId: string) {
    await this.tokenService.revokeAllRefreshTokens(userId);
  }

  async handleGitHubOAuth(githubProfile: {
    id: string;
    username: string;
    displayName: string;
    emails: { value: string }[];
    photos: { value: string }[];
    accessToken: string;
  }) {
    const email = githubProfile.emails?.[0]?.value?.toLowerCase();
    const githubId = githubProfile.id;

    // Try to find by GitHub ID first, then by email
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ githubId }, { email: email ?? undefined }] },
    });

    // Encrypt the GitHub token before storage
    const encryptedToken = this.tokenService.encryptGitHubToken(
      githubProfile.accessToken,
    );

    if (user) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          githubId,
          githubUsername: githubProfile.username,
          githubTokenEnc: encryptedToken,
          avatarUrl: githubProfile.photos?.[0]?.value ?? user.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
    } else {
      if (!email) {
        throw new BadRequestException(
          'GitHub account has no public email. Please add an email to your GitHub account.',
        );
      }

      user = await this.prisma.user.create({
        data: {
          email,
          name: githubProfile.displayName || githubProfile.username,
          githubId,
          githubUsername: githubProfile.username,
          githubTokenEnc: encryptedToken,
          avatarUrl: githubProfile.photos?.[0]?.value,
          emailVerified: true, // GitHub email is pre-verified
        },
      });

      this.logger.log(`New user via GitHub OAuth: ${email}`);
    }

    const tokens = await this.tokenService.generateTokenPair(user.id, user.email);
    const safeUser = this.omitSensitiveFields(user);
    return { user: safeUser, ...tokens };
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...this.safeUserSelect(),
        orgMemberships: {
          where: { organization: { deletedAt: null } },
          include: {
            organization: {
              select: { id: true, name: true, slug: true, plan: true, avatarUrl: true },
            },
          },
        },
      },
    });
  }

  private safeUserSelect() {
    return {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      role: true,
      githubUsername: true,
      emailVerified: true,
      createdAt: true,
    };
  }

  private omitSensitiveFields(user: User) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, githubTokenEnc, ...safe } = user;
    return safe;
  }
}
