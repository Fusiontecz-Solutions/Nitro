// @ts-nocheck
import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import {
  getApplicationForUserByRef,
  getAuthenticatedUserFromRequest,
} from '../services/applicationService';

const applicationAccessDeniedMessage =
  'Forbidden: you do not have access to this application';

async function requireApplicationAccessByRef(
  req: Request,
  res: Response,
  applicationRef: string,
) {
  const authUser = getAuthenticatedUserFromRequest(req);
  const { application, forbidden } = await getApplicationForUserByRef(applicationRef, authUser);
  if (forbidden) {
    res.status(403).json({ success: false, message: applicationAccessDeniedMessage });
    return null;
  }
  if (!application) {
    res.status(404).json({ success: false, message: 'Application not found' });
    return null;
  }
  return application;
}

function isAgentRole(req: Request): boolean {
  return (
    String((req as any).user?.role || '')
      .trim()
      .toUpperCase()
      .replace(/-/g, '_') === 'AGENT'
  );
}

const mapNoteToApi = (note: any) => {
  if (!note) return note;

  const {
    id,
    noteId,
    content,
    application,
    applicationId,
    createdBy,
    createdById,
    createdAt,
    updatedAt,
    ...rest
  } = note;

  const mappedApplication =
    application &&
    ({
      _id: application.id,
      id: application.id,
      applicationId: application.applicationId,
      priority: application.priority,
      type: application.type,
      currentQueue: application.currentQueue,
      currentState: application.currentState,
    } as any);

  const mappedCreatedBy =
    createdBy &&
    ({
      _id: createdBy.id,
      id: createdBy.id,
      firstName: createdBy.firstName,
      lastName: createdBy.lastName,
      email: createdBy.email,
    } as any);

  return {
    ...rest,
    _id: id,
    id,
    noteId,
    content,
    application: mappedApplication ?? applicationId,
    createdBy: mappedCreatedBy ?? createdById,
    createdAt,
    updatedAt,
  };
};

class NoteController {
  // Create a new note
  async create(req: Request, res: Response) {
    try {
      const { content, application } = req.body;

      if (!content || !application) {
        return res.status(400).json({
          success: false,
          message: 'Content and application are required',
        });
      }

      const applicationStr = String(application);
      const appRecord = await requireApplicationAccessByRef(req, res, applicationStr);
      if (!appRecord) {
        return;
      }

      const createdBy = (req as any).user?.id;
      if (!createdBy) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required',
        });
      }

      const note = await prisma.note.create({
        data: {
          content: content.trim(),
          applicationId: appRecord.id,
          createdById: createdBy,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      return res.status(201).json({
        success: true,
        message: 'Note created successfully',
        data: mapNoteToApi(note),
      });
    } catch (error) {
      console.error('Create note error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get all notes with optional filters
  async getAll(req: Request, res: Response) {
    try {
      const { application } = req.query;

      if (isAgentRole(req) && !application) {
        return res.status(200).json({
          success: true,
          data: [],
        });
      }

      const where: any = {};

      if (application) {
        const applicationStr = String(application);
        const appRecord = await requireApplicationAccessByRef(req, res, applicationStr);
        if (!appRecord) {
          return;
        }

        where.applicationId = appRecord.id;
      }

      const notes = await prisma.note.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      return res.status(200).json({
        success: true,
        data: notes.map(mapNoteToApi),
      });
    } catch (error) {
      console.error('Get all notes error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Delete note
  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const note = await prisma.note.findUnique({ where: { id } });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: 'Note not found',
        });
      }

      const appRecord = await requireApplicationAccessByRef(req, res, note.applicationId);
      if (!appRecord) {
        return;
      }

      await prisma.note.delete({ where: { id } });

      return res.status(200).json({
        success: true,
        message: 'Note deleted successfully',
      });
    } catch (error) {
      console.error('Delete note error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

const noteController = new NoteController();
export default noteController;

