import type { Context, Next } from 'hono';
import { supabase } from '../lib/supabase.js';

export const authMiddleware = async (c: Context, next: Next) => {
  // 1. Look for the token in the headers
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid token' }, 401);
  }

  const token = authHeader.split(' ')[1];

  // 2. Ask Supabase to verify the token
  const { data: { user }, error } = await supabase.auth.getUser(token);

  // 3. Reject if invalid
  if (error || !user) {
    return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
  }

  // 4. Attach the verified user to the Hono Context
  c.set('user', user);

  // 5. Allow the request to proceed to the actual route
  await next();
};