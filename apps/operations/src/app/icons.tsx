import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function IconFrame({ children, ...props }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M17 17L21 21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M3 11C3 15.4183 6.58172 19 11 19C13.213 19 15.2161 18.1015 16.6644 16.6493C18.1077 15.2022 19 13.2053 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconFrame>
  );
}

export function EditPencilIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M14.3632 5.65156L15.8431 4.17157C16.6242 3.39052 17.8905 3.39052 18.6716 4.17157L20.0858 5.58579C20.8668 6.36683 20.8668 7.63316 20.0858 8.41421L18.6058 9.8942M14.3632 5.65156L4.74749 15.2672C4.41542 15.5993 4.21079 16.0376 4.16947 16.5054L3.92738 19.2459C3.87261 19.8659 4.39148 20.3848 5.0115 20.33L7.75191 20.0879C8.21972 20.0466 8.65806 19.8419 8.99013 19.5099L18.6058 9.8942M14.3632 5.65156L18.6058 9.8942"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconFrame>
  );
}

export function PlusCircleIcon(props: IconProps) {
  return (
    <IconFrame {...props} strokeWidth={2}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" />
      <path d="M8 12h8" stroke="currentColor" strokeLinecap="round" />
      <path d="M12 8v8" stroke="currentColor" strokeLinecap="round" />
    </IconFrame>
  );
}

export function MessageIcon(props: IconProps) {
  return (
    <IconFrame {...props} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 9h8" stroke="currentColor" />
      <path d="M8 13h6" stroke="currentColor" />
      <path
        d="M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6a3 3 0 0 1 -3 3h-3l-3 3l-3 -3z"
        stroke="currentColor"
      />
    </IconFrame>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <IconFrame {...props} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" stroke="currentColor" />
      <path
        d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.426 2.426 0 0 0 3.42 0l5.58 -5.58a2.426 2.426 0 0 0 0 -3.42l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3z"
        stroke="currentColor"
      />
    </IconFrame>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <IconFrame {...props} data-icon="user">
      <path
        d="M5 20V19C5 15.134 8.13401 12 12 12V12C15.866 12 19 15.134 19 19V20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconFrame>
  );
}
