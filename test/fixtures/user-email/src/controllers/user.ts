import { UserService } from '../services/user.js';

const users = new UserService();

export function updateProfile() {
  users.updateEmail('1', 'a@b.com', true);
}

export function registerRoutes(app: { put: (path: string, handler: () => unknown) => void }) {
  app.put('/api/v1/users/profile', updateProfile);
}
