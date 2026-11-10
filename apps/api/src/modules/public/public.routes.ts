import cors from 'cors';
import express, { Router } from 'express';
import type { AppConfig, PublicLimits } from '../../app.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { parse, parseId } from '../../lib/validate.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';
import { listPublicFeedbackQuerySchema, submitFeedbackSchema } from './public.schemas.js';
import {
  castVote,
  findPublicProject,
  listPublicFeedback,
  removeVote,
  requirePublicBoard,
  submitFeedback,
} from './public.service.js';
import { hashVoterId, optionalVoterId, requireVoterId } from './voter.js';

const MINUTE = 60_000;

export const DEFAULT_PUBLIC_LIMITS: PublicLimits = {
  submit: { windowMs: 10 * MINUTE, limit: 5 },
  vote: { windowMs: 10 * MINUTE, limit: 60 },
  read: { windowMs: MINUTE, limit: 120 },
  dailySubmissionCapPerProject: 200,
};

/**
 * Routes under /api/public. Anyone on the internet can call them, so:
 *  - NO cookies are used or trusted here (nothing for an attacker to hijack),
 *  - any website may call them (that is the whole point of an embeddable widget),
 *  - the request body is capped at a tiny 10 KB,
 *  - every endpoint is rate limited.
 */
export function createPublicRouter({
  prisma,
  config,
}: {
  prisma: PrismaClient;
  config: AppConfig;
}) {
  const router = Router();
  const limits = { ...DEFAULT_PUBLIC_LIMITS, ...config.publicLimits };

  router.use(
    cors({
      origin: '*', // any website; there are no credentials, so this is safe
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Voter-Id'],
      exposedHeaders: ['Retry-After'],
      maxAge: 86_400,
    }),
  );
  router.use(express.json({ limit: '10kb' }));

  const submitLimiter = createRateLimiter(limits.submit);
  const voteLimiter = createRateLimiter(limits.vote);
  const readLimiter = createRateLimiter(limits.read);

  router.post('/projects/:publicKey/feedback', submitLimiter, async (req, res) => {
    const project = await findPublicProject(prisma, req.params.publicKey);
    const input = parse(submitFeedbackSchema, req.body);
    const feedback = await submitFeedback(
      prisma,
      project.id,
      input,
      limits.dailySubmissionCapPerProject,
    );
    res.status(201).json({ feedback });
  });

  router.get('/projects/:publicKey/feedback', readLimiter, async (req, res) => {
    const project = await findPublicProject(prisma, req.params.publicKey);
    requirePublicBoard(project);
    const query = parse(listPublicFeedbackQuerySchema, req.query);
    const voterId = optionalVoterId(req);
    const result = await listPublicFeedback(
      prisma,
      project.id,
      query,
      voterId ? hashVoterId(voterId) : undefined,
    );
    res.json(result);
  });

  router.put('/projects/:publicKey/feedback/:feedbackId/vote', voteLimiter, async (req, res) => {
    const project = await findPublicProject(prisma, req.params.publicKey);
    requirePublicBoard(project);
    const feedbackId = parseId(req.params.feedbackId);
    const voterHash = hashVoterId(requireVoterId(req));
    res.json(await castVote(prisma, project.id, feedbackId, voterHash));
  });

  router.delete('/projects/:publicKey/feedback/:feedbackId/vote', voteLimiter, async (req, res) => {
    const project = await findPublicProject(prisma, req.params.publicKey);
    requirePublicBoard(project);
    const feedbackId = parseId(req.params.feedbackId);
    const voterHash = hashVoterId(requireVoterId(req));
    res.json(await removeVote(prisma, project.id, feedbackId, voterHash));
  });

  return router;
}
