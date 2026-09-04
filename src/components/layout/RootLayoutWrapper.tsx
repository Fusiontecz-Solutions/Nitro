import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import Header from "../sidebar/Header";
import { useSidebar } from "@/components/ui/sidebar";

const RootLayoutWrapper = () => {
    const { state } = useSidebar();
    const location = useLocation();

    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    }, [location.pathname]);

    return (
        <main
            className={`mx-0 ${state === "expanded" ? "w-[calc(100%-var(--sidebar-width))]" : "w-[calc(100%-var(--sidebar-width-icon))]"}`}
        >
            <Header />
            <Suspense
                fallback={
                    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
                        Loading...
                    </div>
                }
            >
                <Outlet />
            </Suspense>
        </main>
    );
};

export default RootLayoutWrapper;
