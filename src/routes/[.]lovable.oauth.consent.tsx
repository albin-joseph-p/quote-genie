import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Minimal typed shim for the beta `supabase.auth.oauth` namespace.
type OAuthResult = {
  data?: {
    client?: { name?: string; client_name?: string; redirect_uris?: string[] } | null;
    scope?: string;
    redirect_url?: string;
    redirect_to?: string;
  } | null;
  error?: { message: string } | null;
};
type OAuthNs = {
  getAuthorizationDetails(id: string): Promise<OAuthResult>;
  approveAuthorization(id: string): Promise<OAuthResult>;
  denyAuthorization(id: string): Promise<OAuthResult>;
};
function oauth(): OAuthNs {
  return (supabase.auth as unknown as { oauth: OAuthNs }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: ConsentPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md p-6 text-sm">
        Could not load this authorization request:{" "}
        {String((error as Error)?.message ?? error)}
      </Card>
    </div>
  ),
});

function ConsentPage() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName =
    details?.client?.name ?? details?.client?.client_name ?? "an application";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-6 space-y-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">
            Connect {clientName} to Orion Sales Corporation
          </h1>
          <p className="text-sm text-muted-foreground">
            {clientName} will be able to call this app&apos;s enabled tools while you
            are signed in.
          </p>
        </div>
        {details?.scope && (
          <div className="text-xs text-muted-foreground border rounded-md p-3">
            <div className="font-medium text-foreground mb-1">Requested access</div>
            <div>{details.scope}</div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          This does not bypass this app&apos;s permissions or backend policies.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => decide(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={busy}
            onClick={() => decide(true)}
          >
            {busy ? "Please wait…" : "Approve"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
