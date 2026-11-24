import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as GoogleStrategyBase, type Profile as GoogleProfile } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategyBase, type Profile as MicrosoftProfile } from 'passport-microsoft';
import type { AppConfig } from '../../config/configuration';

/** Common shape every OAuth provider must produce — a new provider is one strategy class. */
export interface OAuthProvider {
  getName(): string;
  isConfigured(): boolean;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(GoogleStrategyBase, 'google') implements OAuthProvider {
  private readonly configured: boolean;
  constructor(@Inject(ConfigService) config: ConfigService<AppConfig>) {
    const oauth = config.get<AppConfig['oauth']>('oauth')!;
    const clientID = oauth.google.clientId ?? 'not-configured';
    const clientSecret = oauth.google.clientSecret ?? 'not-configured';
    super({ clientID, clientSecret, callbackURL: `${oauth.callbackUrl}/google`, scope: ['email', 'profile'] });
    this.configured = Boolean(oauth.google.clientId && oauth.google.clientSecret);
  }
  getName(): string { return 'google'; }
  isConfigured(): boolean { return this.configured; }
  async validate(_accessToken: string, _refreshToken: string, profile: GoogleProfile): Promise<any> {
    return { provider: 'google', subject: profile.id, email: profile.emails?.[0]?.value, firstName: profile.name?.givenName, lastName: profile.name?.familyName };
  }
}

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(MicrosoftStrategyBase, 'microsoft') implements OAuthProvider {
  private readonly configured: boolean;
  constructor(@Inject(ConfigService) config: ConfigService<AppConfig>) {
    const oauth = config.get<AppConfig['oauth']>('oauth')!;
    const clientID = oauth.microsoft.clientId ?? 'not-configured';
    const clientSecret = oauth.microsoft.clientSecret ?? 'not-configured';
    super({ clientID, clientSecret, callbackURL: `${oauth.callbackUrl}/microsoft`, scope: ['user.read'] });
    this.configured = Boolean(oauth.microsoft.clientId && oauth.microsoft.clientSecret);
  }
  getName(): string { return 'microsoft'; }
  isConfigured(): boolean { return this.configured; }
  async validate(_accessToken: string, _refreshToken: string, profile: MicrosoftProfile): Promise<any> {
    return { provider: 'microsoft', subject: profile.id, email: profile.emails?.[0]?.value, firstName: profile.name?.givenName, lastName: profile.name?.familyName };
  }
}
