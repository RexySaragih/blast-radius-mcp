import { AuthService } from './AuthService.js';

const auth = new AuthService();

export function refreshToken() {
  return auth.validateSession('refresh');
}
