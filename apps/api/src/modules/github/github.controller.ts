import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GitHubService } from './github.service';

@ApiTags('github')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'github', version: '1' })
export class GitHubController {
  constructor(private github: GitHubService) {}

  @Get('repositories')
  @ApiOperation({ summary: 'List authenticated user GitHub repositories' })
  listRepositories(
    @CurrentUser() user: any,
    @Query('page') page = 1,
    @Query('per_page') perPage = 30,
  ) {
    return this.github.listUserRepositories(user.id, +page, +perPage);
  }
}
