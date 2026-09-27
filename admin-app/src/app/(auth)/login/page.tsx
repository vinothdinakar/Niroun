import { LoginForm } from '@bond/console-core/components/login-form';

// Staff accounts are never self-service: no signup link is offered here, regardless of whether the
// customer dashboard has company signup open.
export default function LoginPage() {
  return <LoginForm mode="staff" />;
}
