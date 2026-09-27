import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section className="page-hero">
      <div className="container narrow center">
        <p className="eyebrow">404</p>
        <h1>That page isn’t here.</h1>
        <p className="lead">It may have moved, or the link may be wrong.</p>
        <Link to="/" className="btn btn-primary">Back to home</Link>
      </div>
    </section>
  );
}
