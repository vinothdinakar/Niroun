import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { HowItWorks } from './pages/HowItWorks';
import { Pricing } from './pages/Pricing';
import { Security } from './pages/Security';
import { Developers } from './pages/Developers';
import { Waitlist } from './pages/Waitlist';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="how-it-works" element={<HowItWorks />} />
        <Route path="pricing" element={<Pricing />} />
        <Route path="security" element={<Security />} />
        <Route path="developers" element={<Developers />} />
        <Route path="waitlist" element={<Waitlist />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
