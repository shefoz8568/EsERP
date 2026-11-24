import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleStrategy, MicrosoftStrategy } from './oauth.strategy';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import type { AppConfig } from '../../config/configuration';

@Module({
  imports: [
    ConfigModule, PassportModule, AuditModule, QueueModule,
    // Global: the APP_GUARD JwtAuthGuard (registered in AppModule) needs
    // JwtService outside AuthModule's scope.
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig>) => ({ secret: config.get<string>('jwtAccessSecret') }),
    }),
  ],
  providers: [AuthService, GoogleStrategy, MicrosoftStrategy],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
