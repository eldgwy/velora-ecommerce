import 'dotenv/config';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { z, ZodError } from 'zod';
import path from 'path';
import fs from 'fs';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string(),
  BETTER_AUTH_API_KEY: z.string(),
  BETTER_AUTH_URL: z.url(),

  // SMTP (Nodemailer) – powers transactional emails (email verification, …)
  SMTP_HOST: z.string().min(1, 'SMTP_HOST is required'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // "true" enables implicit TLS (port 465), "false" uses STARTTLS (port 587/25).
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().min(1, 'SMTP_USER is required'),
  SMTP_PASS: z.string().min(1, 'SMTP_PASS is required'),
  // Optional – defaults to "Velora <SMTP_USER>" when omitted.
  SMTP_FROM: z.string().optional(),

  // Cloudinary – signed uploads for product media (server-side only)
  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),
  CLOUDINARY_UPLOAD_PRESET: z.string().optional(),
});

const loadEnvFile = (envPath: string) => {
  try {
    const envFile = path.resolve(process.cwd(), envPath);
    if (fs.existsSync(envFile)) {
      expand(config({ path: envFile }));
    }
  } catch (error) {
    console.error(`Failed to load environment file ${envPath}:`, error);
  }
};

const envFiles = [
  `.env.${process.env.NODE_ENV}`,
  '.env',
];

envFiles.forEach(loadEnvFile);

try {
  envSchema.parse(process.env);
} catch (error) {
  if (error instanceof ZodError) {
    console.error('Invalid environment variables:', error.message);
    process.exit(1);
  }
}

export const env = envSchema.parse(process.env);
