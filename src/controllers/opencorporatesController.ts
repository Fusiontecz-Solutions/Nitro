import type { NextFunction, Request, Response } from 'express';
import { opencorporatesService } from '../services/opencorporatesService';

export const opencorporatesController = {
  async importForApplication(request: Request, response: Response, next: NextFunction) {
    try {
      const applicationId = String(request.params.applicationId ?? '').trim();
      const result = await opencorporatesService.importForApplication(applicationId, request.body);
      response.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};
