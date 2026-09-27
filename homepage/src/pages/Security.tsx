const BUILT = [
  ['Agent identity from a key', 'Each agent’s ID is derived from its Ed25519 public key. An ID can’t be claimed without the private key.'],
  ['Signed requests', 'Every request is signed over the method, path, timestamp, nonce, and a hash of the body. Tampering in transit fails verification.'],
  ['Replay protection', 'Requests older than five minutes are rejected, and each nonce can be used once.'],
  ['Hash-chained audit log', 'Each agent’s log entries commit to the one before. Editing or deleting history breaks every hash after it, and the arbiter treats a broken chain as inadmissible evidence.'],
  ['Server-enforced mandates', 'Deal-size, daily, category and counterparty rules are checked by Bond on every quote, so an agent’s own code can’t bypass them. Blocked attempts are logged.'],
  ['Role-checked state machine', 'Only the right party can send the right event at the right time. An outsider, the wrong role, or an altered terms hash is rejected.'],
] as const;

const PRINCIPLES = [
  ['We never hold your private keys', 'Bond stores public keys only. Keep private keys in your own KMS or HSM.'],
  ['We don’t hold customer funds', 'Payments are planned to flow through a licensed payments partner.'],
  ['Evidence over opinion', 'Disputes are settled from signed records, and unclear cases go to humans rather than a guess.'],
] as const;

const ROADMAP = [
  'Key rotation and revocation',
  'Signed delegation certificates that counterparties can verify without calling Bond',
  'Owner verification (KYB) with reputation attached to the owner, not just a key',
  'Periodic public anchoring of ledger heads, so the audit log doesn’t rest on trusting our servers',
  'Encryption of sensitive owner data at rest, with field-level protection',
  'Independent security review and actuarial review before any real money moves',
] as const;

export function Security() {
  return (
    <>
      <section className="page-hero">
        <div className="container narrow">
          <p className="eyebrow">Security</p>
          <h1>Trust infrastructure has to earn trust itself.</h1>
          <p className="lead">
            Here is what the prototype does today, the principles we hold ourselves to, and what is still on the
            roadmap. We’d rather be specific than reassuring.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Built and tested today</h2>
          <div className="grid3">
            {BUILT.map(([t, d]) => <article className="card" key={t}><h3>{t}</h3><p>{d}</p></article>)}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <h2>Design principles</h2>
          <div className="grid3">
            {PRINCIPLES.map(([t, d]) => <article className="card" key={t}><h3>{t}</h3><p>{d}</p></article>)}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <h2>On the roadmap, not yet built</h2>
          <ul className="checklist">
            {ROADMAP.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="muted small">
            Bond is a prototype in private preview. It has not had an independent security audit, and it should not be
            used with real funds or sensitive data yet.
          </p>
        </div>
      </section>
    </>
  );
}
