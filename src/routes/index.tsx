import type { LoaderFunction, RouteObject } from 'react-router';
import React from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import RootLayout from '../components/layout/RootLayout';
import LoginPage from '../pages/auth/LoginPage';
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage';
import Clients from '../pages/clients/Clients';
import Applications from '../pages/applications/Applications';
import CreateClient from '../pages/clients/clientDetails/CreateClient';
import CreateApplication from '../pages/applications/applicationDetails/CreateApplication';
import ApplicationDetails from '../pages/applications/applicationDetails/ApplicationDetails';
import CreateTermsOffer from '../pages/applications/applicationDetails/CreateTermsOffer';
import CreatePosition from '../pages/applications/applicationDetails/CreatePosition';
import UserSetting from '../pages/Userssettings/UserSetting';
import PublicApprovalPage from '../pages/public/PublicApprovalPage';
import PublicDocumentRequestPage from '../pages/public/PublicDocumentRequestPage';
import PublicApplicationStatusPage from '../pages/public/PublicApplicationStatusPage';
import OperationsDashboard from '../pages/dashboard/OperationsDashboard';
import NotificationDashboard from '../pages/NotificationDashboard/NotificationDashboard';
import { applicationsPageLoader } from './applicationsLoader';

/** Remount when `?query` changes so list state matches URL + route loader. */
const ApplicationsRouteEntry: React.FC = () => {
    const { search } = useLocation();
    return <Applications key={search || '_'} />;
};

/** Alias `/settings` → `/user-setting`, keeping `?tab=` (e.g. funders). */
const SettingsAliasRedirect: React.FC = () => {
    const [searchParams] = useSearchParams();
    const q = searchParams.toString();
    return <Navigate to={q ? `/user-setting?${q}` : '/user-setting'} replace />;
};

type ChildRoute = {
    index?: boolean;
    path?: string;
    element: React.ReactNode;
    loader?: LoaderFunction;
    children?: ChildRoute[];
};

type RouteConfig = {
    path: string;
    element: React.ReactNode;
    children?: ChildRoute[];
};

function mapChildRoutes(children: ChildRoute[]): RouteObject[] {
    return children.map((child): RouteObject => {
        if (child.index) {
            return {
                index: true,
                element: child.element,
                ...(child.loader ? { loader: child.loader } : {}),
            };
        }
        return {
            path: child.path,
            element: child.element,
            ...(child.loader ? { loader: child.loader } : {}),
            ...(child.children?.length
                ? { children: mapChildRoutes(child.children) }
                : {}),
        };
    });
}

const createRoute = (config: RouteConfig): RouteObject => {
    const { path, element, children } = config;
    return {
        path,
        element,
        ...(children?.length ? { children: mapChildRoutes(children) } : {}),
    } as RouteObject;
};

const Routes: RouteObject[] = [
    createRoute({
        path: '/login',
        element: <LoginPage />,
    }),
    createRoute({
        path: '/signup',
        element: <Navigate to="/login" replace />,
    }),
    createRoute({
        path: '/forgot-password',
        element: <ForgotPasswordPage />,
    }),
    // Public shareable links (offer approval / documents — no CRM login)
    createRoute({
        path: '/public/application/status/:token',
        element: <PublicApplicationStatusPage />,
    }),
    createRoute({
        path: '/public/application/approval/:token',
        element: <PublicApprovalPage />,
    }),
    createRoute({
        path: '/public/application/documents/:token',
        element: <PublicDocumentRequestPage />,
    }),
    createRoute({
        path: '/',
        element: <RootLayout />,
        children: [
            { index: true, element: <OperationsDashboard /> },
            { path: 'clients', element: <Clients /> },
            { path: 'create-clients', element: <CreateClient /> },
            { path: 'create-clients/:clientId', element: <CreateClient /> },
            {
                path: 'applications',
                element: <ApplicationsRouteEntry />,
                loader: applicationsPageLoader,
            },
            { path: 'create-applications', element: <CreateApplication /> },
            { path: 'create-applications/:applicationId', element: <CreateApplication /> },
            { path: 'applications/:applicationId/:tab?', element: <ApplicationDetails /> },
            { path: 'application-details/:applicationId', element: <ApplicationDetails /> },
            { path: 'application-details/:applicationId/:tab?', element: <ApplicationDetails /> },
            {
                path: 'application-details/:applicationId/create-terms-offer',
                element: <CreateTermsOffer />,
            },
            {
                path: 'application-details/:applicationId/edit-terms-offer/:termsOfferId',
                element: <CreateTermsOffer />,
            },
            {
                path: 'application-details/:applicationId/view-terms-offer/:termsOfferId',
                element: <CreateTermsOffer />,
            },
            { path: 'create-terms-offer', element: <CreateTermsOffer /> },
            { path: 'edit-terms-offer/:termsOfferId', element: <CreateTermsOffer /> },
            { path: 'view-terms-offer/:termsOfferId', element: <CreateTermsOffer /> },
            {
                path: 'application-details/:applicationId/create-position',
                element: <CreatePosition />,
            },
            {
                path: 'application-details/:applicationId/edit-position/:positionId',
                element: <CreatePosition />,
            },
            {
                path: 'application-details/:applicationId/view-position/:positionId',
                element: <CreatePosition />,
            },
            { path: 'create-position', element: <CreatePosition /> },
            { path: 'edit-position/:positionId', element: <CreatePosition /> },
            { path: 'view-position/:positionId', element: <CreatePosition /> },
            { path: 'user-setting', element: <UserSetting /> },
            { path: 'notifications', element: <NotificationDashboard /> },
            { path: 'settings', element: <SettingsAliasRedirect /> },
            { path: 'settings/*', element: <SettingsAliasRedirect /> },
            // Catch-all: unused modules redirect into the contract workflow
            { path: '*', element: <Navigate to="/applications" replace /> },
        ],
    }),
];

export default Routes;
