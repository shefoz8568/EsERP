import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { AllowHeaderTenant } from '../../common/decorators/permissions.decorator';
import { CurrentUserId } from '../../common/decorators/tenant.decorator';
import { registerDto, loginDto, mfaVerifyDto } from '@eserp/shared';
import type { AppConfig } from '../../config/configuration';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(ConfigService) private readonly config: ConfigService<AppConfig>) {}

  @Post('register')
  @Public()
  async register(@Body() body: unknown) {
    return this.auth.register(registerDto.parse(body));
  }

  @Post('login')
  @Public()
  async login(@Body() body: unknown) {
    const dto = loginDto.parse(body);
    return this.auth.login(dto.email, dto.password, dto.tenantSlug);
  }

  @Post('mfa/verify')
  @Public()
  async mfaVerify(@Body() body: unknown) {
    const dto = mfaVerifyDto.parse(body);
    return this.auth.verifyMfa(dto.mfaToken, dto.code);
  }

  @Post('refresh')
  @Public()
  async refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @Public()
  async logout(@Body() body: { refreshToken: string }) {
    await this.auth.logout(body.refreshToken);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUserId() userId: string, @Req() req: any) {
    return this.auth.me(userId, req.tenantId);
  }

  @Post('mfa/setup')
  async mfaSetup(@CurrentUserId() userId: string, @Req() req: any) {
    const { secret, otpauthUrl, qrDataUrl } = await this.auth.mfaSetup(userId, req.tenantId);
    // `secret` here is a short-lived signed setup token, NOT the TOTP secret —
    // the real secret is stored only after POST /auth/mfa/setup/verify succeeds.
    return { setupToken: secret, otpauthUrl, qrDataUrl };
  }

  @Post('mfa/setup/verify')
  async mfaSetupVerify(@Body() body: { setupToken: string; code: string }) {
    await this.auth.mfaVerifySetup(body.setupToken, body.code);
    return { ok: true };
  }

  @Post('mfa/disable')
  async mfaDisable(@CurrentUserId() userId: string, @Req() req: any) {
    await this.auth.mfaDisable(userId, req.tenantId);
    return { ok: true };
  }

  private oauthConfigured(provider: 'google' | 'microsoft'): boolean {
    const oauth = this.config.get<AppConfig['oauth']>('oauth')!;
    const c = oauth[provider];
    return Boolean(c.clientId && c.clientSecret);
  }

  @Get('oauth/google')
  @Public()
  @AllowHeaderTenant()
  async google(@Res() res: any) {
    if (!this.oauthConfigured('google')) return res.status(501).json({ error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Google OAuth is not configured' } });
    const oauth = this.config.get<AppConfig['oauth']>('oauth')!;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', oauth.google.clientId!);
    url.searchParams.set('redirect_uri', `${oauth.callbackUrl}/google`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'email profile');
    return res.redirect(url.toString());
  }

  @Get('oauth/callback/google')
  @Public()
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any) {
    const tokens = await this.auth.oauthLogin(req.user);
    return tokens;
  }

  @Get('oauth/microsoft')
  @Public()
  @AllowHeaderTenant()
  async microsoft(@Res() res: any) {
    if (!this.oauthConfigured('microsoft')) return res.status(501).json({ error: { code: 'OAUTH_NOT_CONFIGURED', message: 'Microsoft OAuth is not configured' } });
    const oauth = this.config.get<AppConfig['oauth']>('oauth')!;
    const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    url.searchParams.set('client_id', oauth.microsoft.clientId!);
    url.searchParams.set('redirect_uri', `${oauth.callbackUrl}/microsoft`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'user.read');
    return res.redirect(url.toString());
  }

  @Get('oauth/callback/microsoft')
  @Public()
  @UseGuards(AuthGuard('microsoft'))
  async microsoftCallback(@Req() req: any) {
    const tokens = await this.auth.oauthLogin(req.user);
    return tokens;
  }
}
