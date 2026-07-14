export default function IndexBasketArt() {
  return (
    <svg
      className="index-basket-art"
      viewBox="0 0 240 104"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="index-basket-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00f0ff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <path d="M21 27h198l-16 55H37L21 27Z" fill="url(#index-basket-glow)" stroke="#00f0ff" strokeOpacity="0.65" />
      <path d="M14 27h212" stroke="#00f0ff" strokeWidth="3" strokeLinecap="round" />
      <path d="M47 27 58 10h31l-7 17M104 27l4-19h32l4 19M160 27l-7-17h31l11 17" fill="#141a34" stroke="#a78bfa" strokeWidth="1.5" />
      <path d="M36 42h168M39 57h162M43 72h154" stroke="#00f0ff" strokeOpacity="0.24" />
      <circle cx="62" cy="47" r="5" fill="#00f0ff" />
      <circle cx="119" cy="47" r="5" fill="#a78bfa" />
      <circle cx="177" cy="47" r="5" fill="#ff4fd8" />
      <path d="M62 47v25M119 47v25M177 47v25" stroke="#fff" strokeOpacity="0.3" strokeDasharray="2 4" />
      <path d="M70 8c10-7 22-7 31-1M139 7c10-6 21-5 30 2" stroke="#fff" strokeOpacity="0.55" strokeLinecap="round" />
      <text x="120" y="101" textAnchor="middle" fill="#b9c4dd" fontSize="8" fontFamily="monospace" letterSpacing="1.5">CARD BASKET</text>
    </svg>
  );
}
