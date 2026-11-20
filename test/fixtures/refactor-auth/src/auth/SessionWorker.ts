import { AuthService } from './AuthService.js';

const auth = new AuthService();

const producer = {
  send(payload: unknown) {
    return payload;
  },
};

export function SessionWorker() {
  const ok = auth.validateSession('worker-token');
  producer.send({ ok });
  return ok;
}
