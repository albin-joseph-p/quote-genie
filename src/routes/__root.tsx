import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, FileText, Receipt } from "lucide-react";
import { useAppMode, type AppMode } from "@/lib/app-mode";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Page not found.</p>
        <Link to="/" className="mt-6 inline-block text-primary underline">
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Orion Sales Corporation — Quotation Processor" },
      { name: "description", content: "Internal tool to extract, match and price customer quotations." },
      { property: "og:title", content: "Orion Sales Corporation — Quotation Processor" },
      { name: "twitter:title", content: "Orion Sales Corporation — Quotation Processor" },
      { property: "og:description", content: "Internal tool to extract, match and price customer quotations." },
      { name: "twitter:description", content: "Internal tool to extract, match and price customer quotations." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/68f5d911-b433-4630-8243-8d592e0a8371/id-preview-17a8373f--7a680f0d-7053-4cfe-8538-8d97a1c84f79.lovable.app-1782895341990.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/68f5d911-b433-4630-8243-8d592e0a8371/id-preview-17a8373f--7a680f0d-7053-4cfe-8538-8d97a1c84f79.lovable.app-1782895341990.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NavTab({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="px-4 py-2 text-sm font-medium text-muted-foreground rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
      activeProps={{ className: "px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground" }}
      activeOptions={{ exact: true }}
    >
      {label}
    </Link>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthStateBridge />
      <AppShell />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

function AuthStateBridge() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);
  return null;
}

function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthPage =
    pathname === "/auth" || pathname.startsWith("/.lovable/oauth");

  if (isAuthPage) {
    return (
      <div className="min-h-screen">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground font-bold">O</div>
            <span className="font-semibold tracking-tight">Orion Sales Corporation</span>
          </Link>
          <ModeAwareNav />
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function ModeAwareNav() {
  const [mode] = useAppMode();
  return (
    <nav className="flex items-center gap-1 ml-4">
      {mode === "quotation" ? (
        <NavTab to="/" label="Quotation Workspace" />
      ) : (
        <NavTab to="/purchases" label="Purchase Entry" />
      )}
      <NavTab to="/history" label="History" />
      <NavTab to="/categories" label="Categories" />
      <NavTab to="/synonyms" label="Synonyms" />
      <NavTab to="/master" label="Master Inventory" />
    </nav>
  );
}

function ModeToggle() {
  const [mode, setMode] = useAppMode();
  const navigate = useNavigate();
  const switchTo = (m: AppMode) => {
    if (m === mode) return;
    setMode(m);
    navigate({ to: m === "quotation" ? "/" : "/purchases" });
  };
  return (
    <div className="inline-flex items-center rounded-md border bg-muted/40 p-0.5 text-xs">
      <button
        type="button"
        onClick={() => switchTo("quotation")}
        className={`flex items-center gap-1 px-2 py-1 rounded-sm transition-colors ${
          mode === "quotation" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <FileText className="h-3 w-3" /> Quotation
      </button>
      <button
        type="button"
        onClick={() => switchTo("purchase")}
        className={`flex items-center gap-1 px-2 py-1 rounded-sm transition-colors ${
          mode === "purchase" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Receipt className="h-3 w-3" /> Purchase
      </button>
    </div>
  );
}

function AccountMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!email) {
    return (
      <Link to="/auth" className="text-sm text-primary underline">
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground hidden sm:inline">{email}</span>
      <Button variant="ghost" size="sm" onClick={signOut}>
        <LogOut className="h-4 w-4 mr-1" />
        Sign out
      </Button>
    </div>
  );
}
