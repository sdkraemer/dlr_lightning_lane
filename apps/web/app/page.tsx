import { sessionStatus, mockAuth } from '../lib/auth';
import Dashboard from './dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const status = await sessionStatus();
  if (status !== 'authenticated')
    return (
      <main className="login">
        <span className="eyebrow">DISNEYLAND · CALIFORNIA ADVENTURE</span>
        <h1>
          Your next
          <br />
          good window.
        </h1>
        <p>Keep your Lightning Lane plans in view.</p>
        {status === 'anonymous' ? (
          <>
            <a className="primary" href="/auth/login">
              Sign in
            </a>{' '}
            <a className="primary" href="/auth/login?screen_hint=signup">
              Create account
            </a>
          </>
        ) : (
          <p role="alert">
            Authentication is not configured. Set Auth0 environment variables,
            or explicitly enable DEV_MOCK_AUTH in local development.
          </p>
        )}
      </main>
    );
  return <Dashboard mock={mockAuth()} />;
}
