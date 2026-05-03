import { z } from "zod";
import { ROLES } from "../models/User.js";

const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .regex(/[a-z]/, "One lowercase letter required")
  .regex(/[A-Z]/, "One uppercase letter required")
  .regex(/[0-9]/, "One number required")
  .regex(/[^A-Za-z0-9]/, "One special character required");

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  role: z.enum(ROLES),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
