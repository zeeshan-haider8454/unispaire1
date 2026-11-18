// Where each role lands after login.
export function homePathFor(role) {
  if (role === 'admin') return '/admin';
  if (role === 'president') return '/president';
  if (role === 'student') return '/student';
  return '/';
}
