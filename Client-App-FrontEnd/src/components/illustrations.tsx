function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg width="168" height="132" viewBox="0 0 168 132" fill="none" aria-hidden>
      <rect x="8" y="18" width="152" height="96" rx="28" fill="currentColor" className="text-brand-tint" />
      {children}
    </svg>
  );
}

export function IlluCart() {
  return (
    <Frame>
      <path d="M52 48h64l-6 34H62l-10-34z" stroke="currentColor" strokeWidth="3" className="text-accent" fill="none" strokeLinejoin="round" />
      <circle cx="70" cy="94" r="5" className="fill-accent" />
      <circle cx="104" cy="94" r="5" className="fill-accent" />
      <path d="M78 62h20M74 72h28" stroke="currentColor" strokeWidth="2.5" className="text-secondary" strokeLinecap="round" />
    </Frame>
  );
}

export function IlluOrders() {
  return (
    <Frame>
      <rect x="58" y="40" width="52" height="62" rx="8" stroke="currentColor" strokeWidth="3" className="text-accent" fill="none" />
      <path d="M70 54h28M70 66h22M70 78h16" stroke="currentColor" strokeWidth="2.5" className="text-secondary" strokeLinecap="round" />
    </Frame>
  );
}

export function IlluSearch() {
  return (
    <Frame>
      <circle cx="78" cy="62" r="16" stroke="currentColor" strokeWidth="3" className="text-accent" fill="none" />
      <path d="M90 74l16 16" stroke="currentColor" strokeWidth="3" className="text-accent" strokeLinecap="round" />
    </Frame>
  );
}

export function IlluSuccess() {
  return (
    <Frame>
      <circle cx="84" cy="70" r="24" className="fill-accent" />
      <path d="M74 70l7 7 14-16" stroke="currentColor" strokeWidth="3" className="text-inverse" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

export function IlluFail() {
  return (
    <Frame>
      <circle cx="84" cy="70" r="24" fill="#FF3B30" />
      <path d="M76 62l16 16M92 62l-16 16" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}
