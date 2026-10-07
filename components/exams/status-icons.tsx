// Small decorative icons for right/wrong/waiting. Always paired with a word,
// so colour and shape are never the only signal. Decorative (aria-hidden).
const base = { viewBox: "0 0 16 16", className: "size-4 shrink-0", fill: "none", stroke: "currentColor", strokeWidth: 1.75, "aria-hidden": true } as const;

export const CheckIcon = () => (
  <svg {...base}>
    <path d="M3 8.5l3.2 3.2L13 4.8" />
  </svg>
);
export const CrossIcon = () => (
  <svg {...base}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const ClockIcon = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3.2l2 1.3" />
  </svg>
);
export const DashIcon = () => (
  <svg {...base}>
    <path d="M4 8h8" />
  </svg>
);
export const WarnIcon = () => (
  <svg {...base}>
    <path d="M8 2.5l6 10.5H2L8 2.5zM8 7v2.5M8 11.3v.1" />
  </svg>
);
