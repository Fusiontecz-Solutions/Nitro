import type { RootState } from "@/redux/store"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { useEffect, useState } from "react"
import { useSelector } from "react-redux"
import type { user } from "../../redux/slices/authSlice";
import { useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

import { useLocation, useNavigate } from "react-router";

// Map routes to page titles
const getPageTitle = (pathname: string): string => {
    if (pathname === '/' || pathname === '') return 'Dashboard';
    if (pathname.startsWith('/clients') || pathname.startsWith('/create-clients')) return 'Clients';
    if (pathname.startsWith('/applications') || pathname.startsWith('/create-applications')) return 'Applications';
    if (pathname.startsWith('/application-details')) return 'Application';
    if (pathname.startsWith('/notifications')) return 'Notifications';
    if (pathname.startsWith('/user-setting') || pathname.startsWith('/settings')) return 'Settings';
    if (pathname.includes('terms-offer')) return 'Create Offer';
    return 'Contract Workflow';
};

const Header = () => {

    const { state, setOpen } = useSidebar();
    const [user, setUser] = useState<user>()
    const { loading, data } = useSelector((state: RootState) => state.login)
    const { pathname } = useLocation();
    const navigate = useNavigate();

    // Get page title based on current route
    const pageTitle = getPageTitle(pathname);

    useEffect(() => {
        setUser(data?.user)
        if (!data.user) {
            const user = localStorage.getItem('user')
            if (user) {
                setUser(JSON.parse(user))
            }
            else {
                setUser(undefined)
            }
        }

    }, [data, loading])

    return (
        <header className="sticky top-0 z-40 border-b border-border bg-card app-header-scroll-compensate">
            <div className="w-full mx-auto px-6">
                <div className="h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {state === "expanded" ? (
                            <Button variant="outline" size={"sm"} onClick={() => setOpen(false)}>
                                <PanelLeftClose size={20} />
                            </Button>
                        ) : (
                            <Button variant="outline" size={"sm"} onClick={() => setOpen(true)}>
                                <PanelLeftOpen size={20} />
                            </Button>
                        )}
                        <h1 className="text-xl font-semibold text-muted-foreground font-inter">
                            {pageTitle}
                        </h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <ThemeToggle />
                        <button
                            type="button"
                            onClick={() => navigate("/user-setting")}
                            className="flex items-center gap-2 cursor-pointer"
                        >
                            <div className="h-8 w-8 rounded-full bg-[image:var(--brand-gradient)] text-white text-xs font-semibold flex items-center justify-center">{user?.firstName?.slice(0, 1).toUpperCase()}{user?.lastName?.slice(0, 1).toUpperCase()}</div>
                            <div className="hidden sm:block">
                                <div className="text-sm font-medium text-foreground capitalize">{user?.firstName + ' ' + user?.lastName || 'John Doe'}</div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </header>
    )
}

export default Header