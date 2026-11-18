import type { Request, Response } from 'express';
import backgroundCheckService, { BackgroundCheckError } from '../services/backgroundCheckService';

const actor = (req: Request) => ({ id: (req as any).user?.id, role: (req as any).user?.role });

const handle = async (res: Response, fn: () => Promise<unknown>, okStatus = 200) => {
    try {
        const data = await fn();
        return res.status(okStatus).json({ success: true, data });
    } catch (error: any) {
        const status = error instanceof BackgroundCheckError ? error.statusCode : 500;
        if (status >= 500) console.error('[backgroundCheck] error:', error?.message || error);
        return res.status(status).json({ success: false, message: error?.message || 'Internal server error' });
    }
};

class BackgroundCheckController {
    getForApplication(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.getOrCreateForApplication(req.params.applicationId, actor(req)));
    }

    updateItem(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.updateItem(req.params.itemId, req.body ?? {}, actor(req)));
    }

    runItem(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.runAutomatedItem(req.params.itemId, actor(req)));
    }

    addAttachment(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.addAttachment(req.params.itemId, req.body ?? {}, actor(req)), 201);
    }

    removeAttachment(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.removeAttachment(req.params.id, actor(req)));
    }

    setRequired(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.setRequiredFlags(req.params.checkId, req.body?.flags ?? {}, actor(req)));
    }

    decide(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.recordDecision(req.params.checkId, req.body ?? {}, actor(req)));
    }

    reopen(req: Request, res: Response) {
        return handle(res, () => backgroundCheckService.reopen(req.params.checkId, actor(req)));
    }

    audit(req: Request, res: Response) {
        return handle(res, async () => {
            const check = await backgroundCheckService.getCheck(req.params.checkId);
            return (check as any)?.events ?? [];
        });
    }
}

export default new BackgroundCheckController();
