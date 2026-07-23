import type { NextFunction, Request, Response } from 'express';
import { clearService } from '../services/clearService';

export const clearController = {
  async syncBusinessToClient(request: Request, response: Response, next: NextFunction) {
    try {
      const applicationId = String(request.params.applicationId ?? '').trim();
      const user = clearService.getAuthenticatedUser(request);
      const result = await clearService.syncBusinessToClient(
        applicationId,
        request.body,
        user,
        request,
      );
      response.status(200).json({
        success: true,
        message: 'CLEAR business values synced to application.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  async syncPersonToOwner(request: Request, response: Response, next: NextFunction) {
    try {
      const applicationId = String(request.params.applicationId ?? '').trim();
      const user = clearService.getAuthenticatedUser(request);
      const result = await clearService.syncPersonToOwner(
        applicationId,
        request.body,
        user,
        request,
      );
      response.status(200).json({
        success: true,
        message: 'CLEAR person values synced to application owner.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};
