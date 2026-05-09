import {
  Controller, Get, Post, Delete, Patch, Param, Body, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsEnum, MaxLength, IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { OrganizationsService } from './organizations.service';

class CreateOrgDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(100) name: string;
}

class InviteMemberDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ enum: OrgRole }) @IsEnum(OrgRole) role: OrgRole;
}

class UpdateRoleDto {
  @ApiProperty({ enum: OrgRole }) @IsEnum(OrgRole) role: OrgRole;
}

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'organizations', version: '1' })
export class OrganizationsController {
  constructor(private orgs: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  create(@Body() dto: CreateOrgDto, @CurrentUser() user: any) {
    return this.orgs.create(dto.name, user.id);
  }

  @Get(':orgId')
  @ApiOperation({ summary: 'Get organization details' })
  get(@Param('orgId') orgId: string) {
    return this.orgs.findById(orgId);
  }

  @Get(':orgId/members')
  @ApiOperation({ summary: 'List organization members' })
  listMembers(@Param('orgId') orgId: string) {
    return this.orgs.listMembers(orgId);
  }

  @Post(':orgId/members/invite')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Invite a user to the organization' })
  invite(
    @Param('orgId') orgId: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: any,
  ) {
    return this.orgs.inviteMember(orgId, dto.email, dto.role, user.id);
  }

  @Delete(':orgId/members/:userId')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Remove a member from the organization' })
  removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: any,
  ) {
    return this.orgs.removeMember(orgId, userId, user.id);
  }

  @Patch(':orgId/members/:userId/role')
  @Roles(OrgRole.OWNER)
  @ApiOperation({ summary: 'Update member role' })
  updateRole(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.orgs.updateMemberRole(orgId, userId, dto.role);
  }
}
