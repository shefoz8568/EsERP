import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId, CurrentUserId } from '../../common/decorators/tenant.decorator';
import { presignedUrlDto } from '@eserp/shared';

@ApiTags('files')
@Controller('files')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Post('presigned-url')
  @Permissions('files:upload')
  presignedUrl(@CurrentTenantId() t: string, @CurrentUserId() u: string, @Body() body: unknown) {
    return this.files.presignedUrl(t, u, presignedUrlDto.parse(body));
  }

  @Get(':id')
  @Permissions('files:read')
  get(@CurrentTenantId() t: string, @Param('id') id: string) {
    return this.files.getUrl(t, id);
  }
}
