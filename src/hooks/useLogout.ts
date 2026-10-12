import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";
import type { AppDispatch } from "@/redux/store";
import { logout } from "@/redux/actions/authActions";
import { clearApplicationStats, clearApplicationDetail } from "@/redux/slices/applicationSlice";
import { resetOperationsDashboard } from "@/redux/slices/operationsDashboardSlice";
import { clearCrmCacheOnLogout } from "@/lib/crmCache";
import { clearAllPersistentCaches } from "@/lib/persistentCache/clearAllPersistentCaches";
import { clearHttpGetCache } from "@/lib/httpGetCache";

/** CRM sign-out shared by the sidebar and the Gmail account menu. */
export function useLogout() {
  const dispatch: AppDispatch = useDispatch();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    void dispatch(logout());
    dispatch(clearApplicationStats());
    dispatch(clearApplicationDetail());
    dispatch(resetOperationsDashboard());
    clearCrmCacheOnLogout();
    clearHttpGetCache();
    void clearAllPersistentCaches();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("role");
    toast.success("Logged out");
    navigate("/login", { replace: true });
  };

  return { loggingOut, handleLogout };
}
