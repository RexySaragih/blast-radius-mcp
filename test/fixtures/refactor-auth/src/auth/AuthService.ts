export class AuthService {
  validateSession(token: string): boolean {
    return token.length > 0;
  }
}
