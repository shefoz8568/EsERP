declare module 'passport-microsoft' {
  import type { Strategy as PassportStrategy } from 'passport';
  export interface Profile { id: string; displayName?: string; emails?: { value: string }[]; name?: { givenName?: string; familyName?: string } }
  export class Strategy extends PassportStrategy {
    constructor(options: Record<string, unknown>, verify: (...args: any[]) => void);
  }
}
