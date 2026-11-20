export function updateProfileHandler() {
  return null;
}

export function updateAvatarHandler() {
  return null;
}

export function register(app: {
  put: (path: string, handler: () => unknown) => void;
  post: (path: string, handler: () => unknown) => void;
}) {
  app.put('/api/v1/users/profile', updateProfileHandler);
  app.post('/api/v1/users/avatar', updateAvatarHandler);
}
