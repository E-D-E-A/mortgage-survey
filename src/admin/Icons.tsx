// אייקוני SVG מוטמעים (בסגנון lucide, קו 2px) — בלי תלות חיצונית ובלי אימוג'ים.

import type { SVGProps } from 'react';

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const GripIcon = () => (
  <Svg>
    <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
  </Svg>
);

export const ErrorIcon = (props: SVGProps<SVGSVGElement>) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </Svg>
);

export const WarningIcon = (props: SVGProps<SVGSVGElement>) => (
  <Svg {...props}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </Svg>
);

export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <Svg {...props}><polyline points="20 6 9 17 4 12" /></Svg>
);

export const PlusIcon = () => (
  <Svg><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>
);

export const TrashIcon = () => (
  <Svg>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
);

export const BranchIcon = (props: SVGProps<SVGSVGElement>) => (
  <Svg {...props}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </Svg>
);

export const EyeIcon = (props: SVGProps<SVGSVGElement>) => (
  <Svg {...props}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </Svg>
);

export const VarIcon = (props: SVGProps<SVGSVGElement>) => (
  <Svg {...props}>
    <path d="M4 4h16v16H4z" opacity="0" />
    <path d="M7 4c-2 0-2 2-2 4s0 4-2 4c2 0 2 2 2 4s0 4 2 4" />
    <path d="M17 4c2 0 2 2 2 4s0 4 2 4c-2 0-2 2-2 4s0 4-2 4" />
  </Svg>
);

export const LogoutIcon = () => (
  <Svg>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </Svg>
);

export const UpIcon = () => <Svg><polyline points="18 15 12 9 6 15" /></Svg>;
export const DownIcon = () => <Svg><polyline points="6 9 12 15 18 9" /></Svg>;

export const CloseIcon = () => (
  <Svg><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>
);

/** אייקון לפי סוג מסך */
export function TypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'info':
      return <Svg><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></Svg>;
    case 'consent':
      return <Svg><path d="M20 6 9 17l-5-5" /><path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9" opacity="0.4" /></Svg>;
    case 'single':
      return <Svg><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></Svg>;
    case 'multi':
      return <Svg><rect x="3" y="3" width="18" height="18" rx="4" /><polyline points="8 12 11 15 16 9" /></Svg>;
    case 'matrix':
      return <Svg><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></Svg>;
    case 'number':
      return <Svg><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></Svg>;
    case 'text':
      return <Svg><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></Svg>;
    case 'end':
      return <Svg><circle cx="12" cy="12" r="10" /><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" /></Svg>;
    default:
      return <Svg><circle cx="12" cy="12" r="10" /></Svg>;
  }
}
