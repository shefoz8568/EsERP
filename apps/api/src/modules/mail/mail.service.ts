import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/configuration';

export interface MailMessage { to: string; subject: string; text?: string; html?: string; }

export abstract class MailService {
  abstract sendMail(message: MailMessage): Promise<void>;
}

/** SMTP mail service (nodemailer). Locally MailHog captures everything. */
@Injectable()
export class SmtpMailService extends MailService {
  private readonly logger = new Logger(SmtpMailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig>) {
    super();
    const smtp = config.get<AppConfig['smtp']>('smtp')!;
    this.from = smtp.from;
    this.transporter = nodemailer.createTransport({
      host: smtp.host, port: smtp.port,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }

  async sendMail(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
    this.logger.log(`Mail sent to ${message.to}: ${message.subject}`);
  }
}
