import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // getSession() reads the locally stored session (and refreshes it only when
    // expired) instead of a blocking network round-trip on every navigation.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      throw redirect({
        to: "/auth",
        search: { next: location.pathname + location.searchStr },
      });
    }
    return { user };
  },
  component: () => <Outlet />,
});
