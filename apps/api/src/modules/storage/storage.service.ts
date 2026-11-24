import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../config/configuration';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig>) {
    const s3 = config.get<AppConfig['s3']>('s3')!;
    this.bucket = s3.bucket;
    this.client = new S3Client({
      region: s3.region, endpoint: s3.endpoint, forcePathStyle: Boolean(s3.endpoint),
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  storageKey(tenantId: string, fileName: string): string {
    const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${tenantId}/${Date.now()}-${safe}`;
  }

  async presignedUploadUrl(key: string, contentType: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn });
  }

  async presignedGetUrl(key: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }
}
