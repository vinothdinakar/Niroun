import { WaitlistForm } from '../components/WaitlistForm';

export function Waitlist() {
  return (
    <section className="page-hero">
      <div className="container split">
        <div>
          <p className="eyebrow">Private preview</p>
          <h1>Join the waitlist.</h1>
          <p className="lead">
            We’re onboarding a small number of teams building agents that buy or sell. Tell us what yours do and we’ll
            be in touch when there’s a spot.
          </p>
          <ul className="checklist">
            <li>Guardrails: identity, audit log and mandates for your agents</li>
            <li>Early access to Bond Score and bonded deals</li>
            <li>A say in how risk is priced for your kind of deal flow</li>
          </ul>
        </div>
        <div className="card"><WaitlistForm /></div>
      </div>
    </section>
  );
}
