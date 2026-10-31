import type { NextFunction, Request, RequestHandler, Response } from "express";
import { verifyAccessToken } from "../lib/accounts.js";
import { db } from "../lib/supabase.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import type { ProfileRow, TeamMemberRow } from "../types/rows.js";
import { can, type Action } from "../modules/admin/team/permissions.js";

// Who is calling. Both readers and team members send the access token they got from the sign-in routes as
// "Authorization: Bearer <token>"; the token says who they are, and their table says what they may do.

declare global {
  namespace Express {
    interface Request {
      /** The account behind the token, and the session it belongs to. */
      authUser?: { id: string; email: string; sessionId: string };
      accessToken?: string;
      reader?: ProfileRow;
      member?: TeamMemberRow;
    }
  }
}

function bearer(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/** Reads the token and puts its user on the request; throws 401 when there is none or it has expired. */
async function identify(req: Request) {
  const token = bearer(req);
  if (!token) throw unauthorized();
  const user = await verifyAccessToken(token);
  if (!user) throw unauthorized("Your session has expired. Sign in again.");
  req.authUser = user;
  req.accessToken = token;
  return req.authUser;
}

/** Any signed-in user, reader or team. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  await identify(req);
  next();
};

/** A signed-in reader with an active profile. */
export const requireReader: RequestHandler = async (req, _res, next) => {
  const user = await identify(req);
  const { data } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!data) throw forbidden("This account isn't a reader account.");
  if (!data.active) throw forbidden("This account has been deactivated.");
  req.reader = data;
  // Cheap and useful: "last active" on the Users page
  void db.from("profiles").update({ last_active_at: new Date().toISOString() }).eq("id", data.id).then(() => undefined);
  next();
};

/** A signed-in, active team member. */
export const requireTeam: RequestHandler = async (req, _res, next) => {
  const user = await identify(req);
  const { data } = await db.from("team_members").select("*").eq("id", user.id).maybeSingle();
  if (!data) throw forbidden("This account isn't on the team.");
  if (!data.active) throw forbidden("This team account has been deactivated.");
  req.member = data;
  next();
};

/** After requireTeam: the member must hold this permission ("support.reply"). Admins hold everything. */
export const requirePermission =
  (action: Action) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.member) return next(unauthorized());
    if (!can(req.member, action)) return next(forbidden(`You don't have the "${action}" permission.`));
    next();
  };
