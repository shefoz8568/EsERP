import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class FilesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(StorageService) private readonly storage: StorageService, @Inject(AuditService) private readonly audit: AuditService) {}

  async presignedUrl(tenantId: string, actorId: string, dto: { fileName: string; contentType: string; sizeBytes: number; purpose?: string }) {
    const key = this.storage.storageKey(tenantId, dto.fileName);
    const uploadUrl = await this.storage.presignedUploadUrl(key, dto.contentType);
    const asset = await this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.fileAsset.create({ data: { tenantId, fileName: dto.fileName, contentType: dto.contentType, sizeBytes: BigInt(dto.sizeBytes), storageKey: key, bucket: 'eserp-files', purpose: dto.purpose, createdBy: actorId } });
      await this.audit.log({ tenantId, actorId, action: 'upload:FileAsset', entityType: 'FileAsset', entityId: row.id, after: { fileName: dto.fileName } }, tx as any);
      return row;
    });
    return { fileId: asset.id, uploadUrl, storageKey: key };
  }

  async getUrl(tenantId: string, id: string) {
    const asset = await this.prisma.withTenant(tenantId, (tx) => tx.fileAsset.findUnique({ where: { id } }));
    if (!asset || asset.tenantId !== tenantId) throw new NotFoundException('File not found');
    const url = await this.storage.presignedGetUrl(asset.storageKey);
    return { id: asset.id, fileName: asset.fileName, contentType: asset.contentType, sizeBytes: asset.sizeBytes.toString(), url };
  }
}
