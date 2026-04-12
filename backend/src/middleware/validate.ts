import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

/**
 * Validation middleware factory
 */
export function validate(schema: Joi.ObjectSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
      return;
    }

    req.body = value;
    next();
  };
}

// Common validation schemas
export const schemas = {
  register: Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    displayName: Joi.string().min(1).max(100).required(),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  createVideo: Joi.object({
    caption: Joi.string().max(500).required(),
    magnetLink: Joi.string().pattern(/^magnet:\?/).required(),
    // hlsUrl / thumbnailUrl must be https. Joi's default .uri() would
    // happily accept javascript:, data:, http:, file: — which the
    // client hands straight to AVPlayer / a WebView, so a non-https
    // scheme is a direct injection/XSS vector (S2).
    hlsUrl: Joi.string().uri({ scheme: ['https'] }).allow(null, ''),
    thumbnailUrl: Joi.string().uri({ scheme: ['https'] }).required(),
    durationSeconds: Joi.number().integer().min(1).max(300).required(),
    width: Joi.number().integer().min(1).required(),
    height: Joi.number().integer().min(1).required(),
    hashtags: Joi.array().items(Joi.string().max(50)).max(10).default([]),
  }),

  updateVideoUrls: Joi.object({
    hlsUrl: Joi.string().uri({ scheme: ['https'] }),
    magnetLink: Joi.string().pattern(/^magnet:\?/),
  }).min(1),

  likeVideo: Joi.object({
    liked: Joi.boolean().required(),
  }),

  recordView: Joi.object({
    watchedDuration: Joi.number().integer().min(0),
    completionRate: Joi.number().min(0).max(1),
    source: Joi.string().valid('p2p', 'http', 'cache'),
  }),
};
