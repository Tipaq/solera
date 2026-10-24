import { z } from 'zod'

/**
 * Longueur d'un titre que l'agent donne à sa session par `rename_session`.
 *
 * Bornée en caractères et non en mots, qui ne se comptent pas pareil d'une langue à
 * l'autre ; assez court pour tenir sur une ligne de la sidebar. Doit rester d'accord avec
 * `MAX_SESSION_TITLE_CHARS` de `apps/server/src/mcp/solera-mcp.mjs`.
 */
export const MAX_SESSION_TITLE_CHARS = 60

export const renameSessionBodySchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SESSION_TITLE_CHARS)
      .regex(/^[^\u0000-\u001f\u007f]+$/u, 'Un titre sur une ligne, sans caractère de contrôle.'),
  })
  .strict()
