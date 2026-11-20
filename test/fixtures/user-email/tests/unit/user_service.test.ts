import { UserService } from '../../src/services/user.js';

const users = new UserService();

export function runsUpdateEmailTest() {
  users.updateEmail('1', 'a@b.com', true);
}
