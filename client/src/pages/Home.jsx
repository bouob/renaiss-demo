// Placeholder landing page for the P0 scaffold. TASK-007 replaces/extends
// this with the real L1 market-context Dashboard (index tile + sparkline +
// deltas + top-10); kept intentionally minimal here so the build has a real
// route to render without depending on any live Renaiss key.
export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Renaiss Merchant Copilot</h1>
      <p>Scaffold ready — Dashboard (L1 market context) lands in P1.</p>
    </main>
  );
}
