/** A small, deliberately uniform icon set: 16px box, 1.5 stroke, round caps. */

interface Props {
  size?: number;
  className?: string;
}

function Svg({ size = 16, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconSearch = (p: Props) => (
  <Svg {...p}><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2 14 14" /></Svg>
);

export const IconPlus = (p: Props) => (
  <Svg {...p}><path d="M8 3.25v9.5M3.25 8h9.5" /></Svg>
);

export const IconChevronLeft = (p: Props) => (
  <Svg {...p}><path d="M10 3.5 5.5 8l4.5 4.5" /></Svg>
);

export const IconChevronDown = (p: Props) => (
  <Svg {...p}><path d="M3.5 6 8 10.5 12.5 6" /></Svg>
);

export const IconX = (p: Props) => (
  <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>
);

export const IconGrid = (p: Props) => (
  <Svg {...p}>
    <rect x="2.25" y="2.25" width="5" height="5" rx="1" />
    <rect x="8.75" y="2.25" width="5" height="5" rx="1" />
    <rect x="2.25" y="8.75" width="5" height="5" rx="1" />
    <rect x="8.75" y="8.75" width="5" height="5" rx="1" />
  </Svg>
);

export const IconList = (p: Props) => (
  <Svg {...p}><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></Svg>
);

export const IconGallery = (p: Props) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 10.5 5.5 7l3 3L11 8l3 2.5" />
    <circle cx="6" cy="5.75" r="0.9" />
  </Svg>
);

export const IconSort = (p: Props) => (
  <Svg {...p}><path d="M4 3v10M4 13l-2-2M4 13l2-2M11 13V3M11 3l-2 2M11 3l2 2" /></Svg>
);

export const IconFilter = (p: Props) => (
  <Svg {...p}><path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.3V8.5z" /></Svg>
);

export const IconStar = ({ size = 16, className }: Props) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
    <path d="M8 1.6l1.85 3.9 4.15.6-3 3 .71 4.3L8 11.35 4.29 13.4 5 9.1l-3-3 4.15-.6z" />
  </svg>
);

export const IconStarOutline = (p: Props) => (
  <Svg {...p}><path d="M8 1.9l1.78 3.75 3.99.58-2.89 2.88.69 4.13L8 11.3l-3.57 1.94.69-4.13L2.23 6.23l3.99-.58z" /></Svg>
);

export const IconHeart = ({ size = 16, className }: Props) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
    <path d="M8 13.8S1.9 10.2 1.9 6.1A3.1 3.1 0 0 1 8 4.7a3.1 3.1 0 0 1 6.1 1.4c0 4.1-6.1 7.7-6.1 7.7z" />
  </svg>
);

export const IconHeartOutline = (p: Props) => (
  <Svg {...p}><path d="M8 13.4S2.3 10 2.3 6.2A2.7 2.7 0 0 1 8 4.9a2.7 2.7 0 0 1 5.7 1.3c0 3.8-5.7 7.2-5.7 7.2z" /></Svg>
);

export const IconBook = (p: Props) => (
  <Svg {...p}><path d="M3 2.75h6a2 2 0 0 1 2 2v8.5a1.5 1.5 0 0 0-1.5-1.5H3z" /><path d="M13 3.75v9.5" /></Svg>
);

export const IconCalendar = (p: Props) => (
  <Svg {...p}>
    <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.5" />
    <path d="M2.25 6.5h11.5M5.5 2v2.5M10.5 2v2.5" />
  </Svg>
);

export const IconSettings = (p: Props) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.75v1.4M8 12.85v1.4M14.25 8h-1.4M3.15 8h-1.4M12.42 3.58l-1 1M4.58 11.42l-1 1M12.42 12.42l-1-1M4.58 4.58l-1-1" />
  </Svg>
);

export const IconArchive = (p: Props) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="3" rx="1" />
    <path d="M3 6.5v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6M6.5 9h3" />
  </Svg>
);

export const IconSync = (p: Props) => (
  <Svg {...p}>
    <path d="M13.3 7A5.3 5.3 0 0 0 3.6 4.9M2.7 9A5.3 5.3 0 0 0 12.4 11.1" />
    <path d="M13.6 3.4V7h-3.4M2.4 12.6V9h3.4" />
  </Svg>
);

export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <path d="M2.75 4.25h10.5M6 4.25V3a.75.75 0 0 1 .75-.75h2.5A.75.75 0 0 1 10 3v1.25" />
    <path d="M4 4.25l.6 8.2a1 1 0 0 0 1 .93h4.8a1 1 0 0 0 1-.93l.6-8.2" />
  </Svg>
);

export const IconImage = (p: Props) => (
  <Svg {...p}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 10.5 5.5 7l3 3L11 8l3 2.5" />
  </Svg>
);

export const IconEdit = (p: Props) => (
  <Svg {...p}><path d="M10.6 2.9l2.5 2.5M11.9 1.6a1.4 1.4 0 0 1 2 2L5.3 12.2l-3 .9.9-3z" /></Svg>
);

export const IconDrag = (p: Props) => (
  <Svg {...p}>
    <circle cx="6" cy="3.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="3.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconCheck = (p: Props) => (
  <Svg {...p}><path d="M3 8.4l3.2 3.2L13 4.8" /></Svg>
);

export const IconLink = (p: Props) => (
  <Svg {...p}>
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 1 0-3.7-3.7l-1 1" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.6 8.7a2.6 2.6 0 1 0 3.7 3.7l1-1" />
  </Svg>
);
