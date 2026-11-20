import { AuthService } from './AuthService.js';

const auth = new AuthService();

export function loginHandler() {
  return auth.validateSession('token');
}

export function registerRoutes(app: { post: (path: string, handler: () => unknown) => void }) {
  app.post('/login', loginHandler);
}
