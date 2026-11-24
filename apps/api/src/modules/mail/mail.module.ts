import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService, SmtpMailService } from './mail.service';

@Module({ imports: [ConfigModule], providers: [{ provide: MailService, useClass: SmtpMailService }], exports: [MailService] })
export class MailModule {}
