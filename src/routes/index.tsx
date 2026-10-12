import type { LoaderFunction, RouteObject } from 'react-router';
import React, { lazy } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import RootLayout from '../components/layout/RootLayout';
import LoginPage from '../pages/auth/LoginPage';
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage';
import { applicationsPageLoader } from './applicationsLoader';
import { resolveEffectiveRole } from '../lib/sessionRole';
import { isWorkflowRole } from '../lib/roleAccess';

const Clients = lazy(() => import('../pages/clients/Clients'));
const Applications = lazy(() => import('../pages/applications/Applications'));
const CreateClient = lazy(() => import('../pages/clients/clientDetails/CreateClient'));
const CreateApplication = lazy(
    () => import('../pages/applications/applicationDetails/CreateApplication'),
);
const ApplicationDetails = lazy(
    () => import('../pages/applications/applicationDetails/ApplicationDetails'),
);
const CreateTermsOffer = lazy(
    () => import('../pages/applications/applicationDetails/CreateTermsOffer'),
);
const CreatePosition = lazy(
    () => import('../pages/applications/applicationDetails/CreatePosition'),
);
const UserSetting = lazy(() => import('../pages/Userssettings/UserSetting'));
const PublicApprovalPage = lazy(() => import('../pages/public/PublicApprovalPage'));
const SigningPortalPage = lazy(() => import('../pages/public/SigningPortalPage'));
const PublicDocumentRequestPage = lazy(
    () => import('../pages/public/PublicDocumentRequestPage'),
);
const PublicApplicationStatusPage = lazy(
    () => import('../pages/public/PublicApplicationStatusPage'),
);
const SignNowEmbeddedCompletePage = lazy(
    () => import('../pages/public/SignNowEmbeddedCompletePage'),
);
const OperationsDashboard = lazy(() => import('../pages/dashboard/OperationsDashboard'));
const NotificationDashboard = lazy(
    () => import('../pages/NotificationDashboard/NotificationDashboard'),
);

const WorkflowDashboard = lazy(() => import('../pages/workflow/WorkflowDashboard'));
const WorkflowQueuePage = lazy(() => import('../pages/workflow/WorkflowQueuePage'));
const TemplatePlayground = lazy(() => import('../pages/templates/TemplatePlayground'));
const GmailPage = lazy(() => import('../pages/gmailModule/gmail'));

const ApplicationsRouteEntry: React.FC = () => <Applications />;

/** `/`: Super Admin keeps the contract dashboard; Agent / Underwriter get their workflow dashboard. */
const DashboardEntry: React.FC = () =>
    isWorkflowRole(resolveEffectiveRole(undefined)) ? <WorkflowDashboard /> : <OperationsDashboard />;

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
    // Merchant signing portal for contracts emailed via SendGrid (token in the link)
    createRoute({
        path: '/sign/:envelopeId',
        element: <SigningPortalPage />,
    }),
    createRoute({
        path: '/embedded-complete',
        element: <SignNowEmbeddedCompletePage />,
    }),
    createRoute({
        path: '/',
        element: <RootLayout />,
        children: [
            { index: true, element: <DashboardEntry /> },
            // Agent / Underwriter queues (Super Admin: workflow oversight via ?scope=)
            { path: 'pipeline', element: <WorkflowQueuePage /> },
            { path: 'workflow-dashboard', element: <WorkflowDashboard /> },
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
            { path: 'letter-generator', element: <Applications mode="letterGenerator" /> },
            { path: 'user-setting', element: <UserSetting /> },
            { path: 'notifications', element: <NotificationDashboard /> },
            { path: 'gmail', element: <GmailPage /> },
            // Preview / test every built-in email + letter template
            { path: 'template/playground', element: <TemplatePlayground /> },
            { path: 'templates/playground', element: <Navigate to="/template/playground" replace /> },
            { path: 'settings', element: <SettingsAliasRedirect /> },
            { path: 'settings/*', element: <SettingsAliasRedirect /> },
            // Catch-all: unused modules redirect into the contract workflow
            { path: '*', element: <Navigate to="/applications" replace /> },
        ],
    }),
];

export default Routes;
