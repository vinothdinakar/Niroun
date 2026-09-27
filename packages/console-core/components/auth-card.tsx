import type { ReactNode } from 'react';

/** The centred card every signed-out screen sits in. `subtitle` names which console this is (they now have separate origins). */
export function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-card">
        <div className="brand"><h1>Bond<span>.</span></h1><p>{subtitle}</p></div>
        {children}
      </main>
    </div>
  );
}
