import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(),
  }),
  usePathname: () => "/",
}));

// Mock next/image (raw <img> is intentional here: the mock itself must not
// recurse into next/image).
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, ...props }: Record<string, unknown>) => <img src={src as string} alt={alt as string} {...props} />,
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => {
  const icons = [
    "MailIcon",
    "LockIcon",
    "EyeIcon",
    "EyeOffIcon",
    "AlertTriangleIcon",
    "BadgeCheckIcon",
    "ShieldCheckIcon",
    "UserRoundIcon",
    "PhoneIcon",
    "CalendarDaysIcon",
    "Spinner",
  ];
  const mockIcon = (name: string) => ({ name, render: () => <span data-testid={name.toLowerCase()} /> });
  return icons.reduce((acc, name) => ({ ...acc, [name]: mockIcon(name) }), {});
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  Toaster: () => null,
}));

// Mock react-hook-form
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: vi.fn(),
    handleSubmit: vi.fn((fn) => fn),
    formState: { errors: {} },
    watch: vi.fn(),
    setValue: vi.fn(),
    trigger: vi.fn(),
    reset: vi.fn(),
  }),
  Controller: ({ render }: { render: (props: { field: { onChange: () => void; onBlur: () => void; value: string }; fieldState: { invalid: boolean; error: null } }) => React.ReactElement }) => render({ field: { onChange: vi.fn(), onBlur: vi.fn(), value: "" }, fieldState: { invalid: false, error: null } }),
}));

// Mock @hookform/resolvers/zod
vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: vi.fn(() => vi.fn()),
}));

// Mock environment variables
vi.stubEnv("NODE_ENV", "test");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-key-for-testing-only");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SMTP_HOST", "localhost");
vi.stubEnv("SMTP_PORT", "587");
vi.stubEnv("SMTP_USER", "test");
vi.stubEnv("SMTP_PASS", "test");
vi.stubEnv("SMTP_FROM", "test@example.com");