import {ownerStatus,mockAuth} from '../lib/auth';
import Dashboard from './dashboard';
export const dynamic='force-dynamic';
export default async function Page() {
  const status=await ownerStatus();
  if(status!=='owner')return <main className="login"><span className="eyebrow">DISNEYLAND · CALIFORNIA ADVENTURE</span><h1>Your next<br/>good window.</h1>
    <p>Keep your Lightning Lane plans in view.</p>
    {status==='anonymous'?<a className="primary" href="/auth/login">Sign in</a>:<p role="alert">{status==='forbidden'?'This account does not have access.':'Authentication is not configured. Set Auth0 environment variables, or explicitly enable DEV_MOCK_AUTH in local development.'}</p>}
    {status==='forbidden'&&<a href="/auth/logout">Sign out</a>}</main>;
  return <Dashboard mock={mockAuth()}/>;
}
