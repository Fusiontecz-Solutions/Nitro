import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useDispatch } from "react-redux";
import { axiosGet, axiosPost } from "@/redux/axios";
import { RequestedDocumentsPanel } from "@/components/application/RequestedDocumentsPanel";
import { getDocumentRequestsByApplication } from "@/redux/actions/notificationActions";
import type { AppDispatch } from "@/redux/store";
import { formatDate, formatDateTimeUS } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { resolveAppLogoSrc } from "@/constants/appLogo";

type PortalApplication = {
  id: string;
  applicationId?: number;
  currentQueue?: string | null;
  currentState?: string | null;
  type?: string | null;
  loanAmount?: number | null;
  updatedAt?: string;
  createdAt?: string;
  client?: {
    businessName?: string | null;
    ownerFirstName?: string | null;
    ownerLastName?: string | null;
  } | null;
};

type PortalStatusResponse = {
  success: boolean;
  data?: {
    application: PortalApplication;
    expiresAt: string | Date | null;
  };
  code?: string;
  message?: string;
};

const PublicApplicationStatusPage = () => {
  const { token } = useParams<{ token: string }>();
  const dispatch = useDispatch<AppDispatch>();
  const { resolvedTheme } = useTheme();
  const brandLogo = (
    <img
      src={resolveAppLogoSrc(resolvedTheme === "dark")}
      alt="Company logo"
      className="mx-auto h-20 w-auto max-w-full object-contain sm:h-24"
    />
  );

  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | Date | null>(null);
  const [application, setApplication] = useState<PortalApplication | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      if (!token) {
        if (isMounted) {
          setLoading(false);
          setErrorCode("TOKEN_MISSING");
        }
        return;
      }

      try {
        const res = await axiosGet(`/public/application/${token}/portal-status`);
        const body = res.data as PortalStatusResponse;

        if (!isMounted) return;

        if (!body?.success || !body?.data?.application) {
          setErrorCode(body?.code === "TOKEN_EXPIRED" ? "TOKEN_EXPIRED" : "INVALID_TOKEN");
          if (body?.code === "TOKEN_EXPIRED" && body.data && "expiresAt" in body) {
            setExpiresAt((body as { data?: { expiresAt?: string | null } }).data?.expiresAt ?? null);
          }
          setLoading(false);
          return;
        }

        setApplication(body.data.application);
        setExpiresAt(body.data.expiresAt ?? null);

        try {
          const sessionRes = await axiosPost(`/public/application/${token}/approval-session`, {});

          const sessionBody = sessionRes.data as {
            success: boolean;
            token?: string;
            user?: any;
            applicationId?: string;
            message?: string;
          };

          if (!sessionBody?.success || !sessionBody?.token || !sessionBody?.user) {
            throw new Error(sessionBody?.message || "Failed to create public session");
          }

          localStorage.setItem("token", sessionBody.token);
          localStorage.setItem("role", sessionBody.user.role);
          localStorage.setItem("user", JSON.stringify(sessionBody.user));

          const docRequestLookup =
            body.data.application?.applicationId ?? body.data.application?.id;
          if (docRequestLookup != null) {
            void dispatch(getDocumentRequestsByApplication(docRequestLookup))
              .unwrap()
              .catch(() => {});
          }

          if (!isMounted) return;
          setSessionError(null);
          setLoading(false);
        } catch (sessErr: unknown) {
          if (!isMounted) return;
          const msg =
            sessErr && typeof sessErr === "object" && "message" in sessErr
              ? String((sessErr as { message?: string }).message)
              : "Could not start a secure session";
          setSessionError(msg);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        const status =
          err && typeof err === "object" && "response" in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 410) {
          setErrorCode("TOKEN_EXPIRED");
          const exp =
            err && typeof err === "object" && "response" in err
              ? (err as { response?: { data?: { expiresAt?: string } } }).response?.data?.expiresAt
              : undefined;
          setExpiresAt(exp ?? null);
        } else if (status === 404) {
          setErrorCode("INVALID_TOKEN");
        } else {
          setErrorCode("INVALID_TOKEN");
        }
        setLoading(false);
      }
    };

    void run();
    return () => {
      isMounted = false;
    };
  }, [token, dispatch]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 text-center">{brandLogo}</div>
          <div className="text-sm text-[#687182]">Loading…</div>
        </div>
      </div>
    );
  }

  if (errorCode) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 text-center">{brandLogo}</div>
          <div className="mt-6 rounded-md border border-[#E5E7EB] bg-white p-4 text-sm text-[#687182]">
            <div className="font-semibold text-[#151357]">
              {errorCode === "TOKEN_EXPIRED" ? "Link expired" : "Link not available"}
            </div>
            {errorCode === "TOKEN_EXPIRED" && expiresAt ? (
              <div className="mt-1">This link expired on {formatDateTimeUS(expiresAt)}</div>
            ) : (
              <div className="mt-1">Please ask your representative for a new secure link.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (sessionError && !application) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 text-center">{brandLogo}</div>
          <div className="mt-6 rounded-md border border-[#E5E7EB] bg-white p-4 text-sm text-[#687182]">
            <div className="font-semibold text-[#151357]">Session error</div>
            <div className="mt-1">{sessionError}</div>
          </div>
        </div>
      </div>
    );
  }

  const app = application;
  const canUseInteractivePortal = !sessionError && Boolean(app);

  const businessName = app?.client?.businessName?.trim() || "";
  const appRef =
    app?.applicationId != null
      ? `#${app.applicationId}`
      : app?.id
        ? `${app.id.slice(0, 8)}…`
        : "";

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 text-center">{brandLogo}</div>

        {expiresAt ? (
          <p className="mb-4 text-right text-xs text-[#9CA3AF]">
            Secure link expires {formatDate(expiresAt)}.
          </p>
        ) : null}

        {sessionError && app ? (
          <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <div className="font-semibold">Limited access</div>
            <p className="mt-1 text-amber-900/90">
              Document upload could not be fully enabled. Contact your representative if this
              persists. ({sessionError})
            </p>
          </div>
        ) : null}

        {canUseInteractivePortal && app ? (
          <>
            <div className="mb-6 rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <h1 className="text-lg font-semibold text-[#151357]">Upload requested documents</h1>
              <p className="mt-1 text-sm text-[#687182]">
                Application {appRef}
                {businessName ? ` · ${businessName}` : ""}
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">
                No CRM login required. Upload each requested file below.
              </p>
            </div>

            <RequestedDocumentsPanel
              applicationUuid={app.id}
              applicationLookupId={app.applicationId ?? app.id}
              businessApplicationId={app.applicationId ?? null}
            />
          </>
        ) : null}
      </div>
    </div>
  );
};

export default PublicApplicationStatusPage;
