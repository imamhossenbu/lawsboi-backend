import { z } from "zod";
import { MIN_PASSWORD } from "../../lib/passwords.js";

export const lang = z.enum(["en", "bn"]).default("en");
export const email = z.email("Enter a valid email address.").max(254).transform((v) => v.trim().toLowerCase());
export const password = z.string().min(MIN_PASSWORD, `Use at least ${MIN_PASSWORD} characters.`).max(128);
export const code = z.string().regex(/^\d{6}$/, "Enter the 6-digit code.");

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email,
  password,
  lang,
});

export const verifySchema = z.object({ email, code, purpose: z.enum(["signup", "reset"]) });
export const resendSchema = z.object({ email, purpose: z.enum(["signup", "reset"]), lang });
export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password.") });
export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export const forgotSchema = z.object({ email, lang });
export const resetSchema = z.object({ email, code, password });
export const changePasswordSchema = z.object({ current: z.string().min(1), password });

export type Signup = z.infer<typeof signupSchema>;

export const googleSchema = z.object({ code: z.string().min(1).max(2048), redirectUri: z.url().max(500), lang });
